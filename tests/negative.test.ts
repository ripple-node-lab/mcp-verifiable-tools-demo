import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { EXTENSION_ID, META_CLIENT_CAPABILITIES, clientCapabilities, expectedCircuitHash, b64u } from "@demo/protocol";
import { encryptArguments, VerifiableClient } from "@demo/client";
import { VerificationKeyRegistry } from "@demo/verifier";
import { withServer, expectComplete, expectTask, rpc } from "./helpers.js";

test("invalid HTTP method header is rejected", async () => withServer(async (server) => {
  const response = await rpc(server, "tools/call", { name: "add", arguments: { a: 1, b: 2 } }, { "Mcp-Method": "tools/list", "Mcp-Name": "add" });
  assert.equal(response.error?.code, -32600);
}));

test("missing Mcp-Name on tools/call is rejected", async () => withServer(async (server) => {
  const response = await rpc(server, "tools/call", { name: "add", arguments: { a: 1, b: 2 } });
  assert.equal(response.error?.code, -32600);
}));

test("unsupported requested proof format is rejected when required", async () => withServer(async (server) => {
  const response = await rpc(server, "tools/call", { name: "add", arguments: { a: 1, b: 2 }, _meta: { [META_CLIENT_CAPABILITIES]: clientCapabilities(["demo-sig-v1"], { requireProof: true }), [EXTENSION_ID]: { requestedProofFormat: "nope" } } }, { "Mcp-Name": "add" });
  assert.equal(response.error?.code, -32602);
}));

test("tampered proof does not verify", async () => withServer(async (server) => {
  const client = new VerifiableClient(server.mcpUrl);
  await client.discover();
  const call = await client.callTool("add", { a: 1, b: 2 }, { proofFormat: "demo-sig-v1" });
  const result = expectComplete(call.result);
  const meta = result._meta?.[EXTENSION_ID];
  if (meta?.proof) meta.proof = `${meta.proof}00`;
  const outcome = await client.verify(result, { a: 1, b: 2 }, "add", { nonce: call.nonce });
  assert.equal(outcome.ok, false);
  if (outcome.ok) throw new Error("tampered proof unexpectedly verified");
  assert.equal(outcome.reason, "proofInvalid");
}));

test("tampered circuitHash does not verify in either format", async () => withServer(async (server) => {
  const client = new VerifiableClient(server.mcpUrl);
  await client.discover();
  for (const format of ["demo-sig-v1", "demo-commit-v1"]) {
    const result = expectComplete((await client.callTool("add", { a: 1, b: 2 }, { proofFormat: format })).result);
    if (!result._meta?.[EXTENSION_ID]) throw new Error("missing proof");
    result._meta[EXTENSION_ID].circuitHash = "0x" + "00".repeat(32);
    const outcome = await client.verify(result, { a: 1, b: 2 }, "add");
    assert.equal(outcome.ok, false);
    if (outcome.ok) throw new Error("tampered circuit unexpectedly verified");
    assert.equal(outcome.reason, "circuitHashMismatch");
  }
}));

test("blind commitment mismatch is invalid params", async () => withServer(async (server) => {
  const client = new VerifiableClient(server.mcpUrl);
  const discovery = await client.discover();
  const encrypted = encryptArguments({ income: 100, debt: 20 }, discovery.blindPublicKeys["hpke-v1"], "privateCreditCheck");
  const response = await rpc(server, "verifiable-tools/call", {
    tool: "privateCreditCheck",
    inputCommitment: "0x" + "00".repeat(32),
    encryptionScheme: "hpke-v1",
    encryptedArguments: encrypted.encryptedArguments,
    proofFormat: "demo-sig-v1",
    _meta: { [META_CLIENT_CAPABILITIES]: clientCapabilities(["demo-sig-v1"], { blindExecution: true }) }
  });
  assert.equal(response.error?.code, -32602);
}));

test("blind call requires declared blind execution", async () => withServer(async (server) => {
  const client = new VerifiableClient(server.mcpUrl);
  const discovery = await client.discover();
  const encrypted = encryptArguments({ income: 100, debt: 20 }, discovery.blindPublicKeys["hpke-v1"], "privateCreditCheck");
  const params = {
    tool: "privateCreditCheck",
    inputCommitment: encrypted.inputCommitment,
    encryptionScheme: "hpke-v1",
    encryptedArguments: encrypted.encryptedArguments,
    proofFormat: "demo-sig-v1"
  };
  const omitted = await rpc(server, "verifiable-tools/call", params);
  assert.equal(omitted.error?.code, -32602);
  const disabled = await rpc(server, "verifiable-tools/call", { ...params, _meta: { [META_CLIENT_CAPABILITIES]: clientCapabilities(["demo-sig-v1"], { blindExecution: false }) } });
  assert.equal(disabled.error?.code, -32602);
}));

test("verification key pinning rejects a changed key", async () => {
  const first = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }) as string;
  const second = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }) as string;
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = (async () => {
    fetchCount += 1;
    const pem = fetchCount === 1 ? first : second;
    return { ok: true, headers: { get: () => null }, text: async () => pem };
  }) as unknown as typeof fetch;
  try {
    const registry = new VerificationKeyRegistry(["http://one", "http://two"]);
    await assert.rejects(() => Promise.all([registry.get("0xcircuit", "http://one"), registry.get("0xcircuit", "http://two")]));
    assert.equal(fetchCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("client rejects an unadvertised result format", async () => withServer(async (server) => {
  const client = new VerifiableClient(server.mcpUrl);
  await client.discover();
  const result = expectComplete((await client.callTool("add", { a: 1, b: 2 }, { proofFormat: "demo-commit-v1" })).result);
  client.setCapabilities({ proofFormats: ["demo-sig-v1"] });
  const outcome = await client.verify(result, { a: 1, b: 2 }, "add");
  assert.equal(outcome.ok, false);
  if (outcome.ok) throw new Error("unadvertised format unexpectedly verified");
  assert.equal(outcome.reason, "formatNotNegotiated");
}));

test("invalid tool arguments are invalid params", async () => withServer(async (server) => {
  const response = await rpc(server, "tools/call", { name: "add", arguments: { a: "x", b: 2 } }, { "Mcp-Name": "add" });
  assert.equal(response.error?.code, -32602);
  const client = new VerifiableClient(server.mcpUrl);
  await client.discover();
  client.setCapabilities({ proofFormats: ["demo-sig-v1"] }, true);
  const task = expectTask((await client.callTool("riskScore", { symbol: 1 }, { proofFormat: "demo-sig-v1" })).result);
  await new Promise<void>((resolve) => setTimeout(resolve, 350));
  const failed = await rpc(server, "tasks/get", { taskId: task.taskId });
  assert.equal(failed.result?.status, "failed");
}));

test("foreign server-minted circuit is rejected", async () => withServer(async (server) => {
  const client = new VerifiableClient(server.mcpUrl);
  await client.discover();
  const result = expectComplete((await client.callTool("riskScore", { symbol: "AAPL" }, { proofFormat: "demo-sig-v1" })).result);
  assert.equal(result._meta?.[EXTENSION_ID]?.circuitHash, expectedCircuitHash("riskScore"));
  const outcome = await client.verify(result, { symbol: "AAPL" }, "add");
  assert.equal(outcome.ok, false);
  if (outcome.ok) throw new Error("foreign circuit unexpectedly verified");
  assert.equal(outcome.reason, "circuitHashMismatch");
}));

test("verification key registry rejects disallowed origins", async () => {
  const registry = new VerificationKeyRegistry(["http://127.0.0.1"]);
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = (async () => {
    fetchCount += 1;
    throw new Error("unexpected fetch");
  }) as unknown as typeof fetch;
  try {
    await assert.rejects(() => registry.get("0xcircuit", "http://169.254.169.254/latest"));
    assert.equal(fetchCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("unknown verification key circuit returns 404", async () => withServer(async (server) => {
  const response = await fetch(`${server.url}/vk/0xdeadbeef`);
  assert.equal(response.status, 404);
}));

test("oversized blind ciphertext is invalid params", async () => withServer(async (server) => {
  const client = new VerifiableClient(server.mcpUrl);
  const discovery = await client.discover();
  const encrypted = encryptArguments({ income: 100, debt: 20 }, discovery.blindPublicKeys["hpke-v1"], "privateCreditCheck");
  const oversized = b64u(new Uint8Array([...Buffer.from(encrypted.encryptedArguments, "base64url"), ...new Uint8Array(128 * 1024)]));
  const response = await rpc(server, "verifiable-tools/call", {
    tool: "privateCreditCheck",
    inputCommitment: encrypted.inputCommitment,
    encryptionScheme: "hpke-v1",
    encryptedArguments: oversized,
    proofFormat: "demo-sig-v1",
    _meta: { [META_CLIENT_CAPABILITIES]: clientCapabilities(["demo-sig-v1"], { blindExecution: true }) }
  });
  assert.equal(response.error?.code, -32602);
}));
