import test from "node:test";
import assert from "node:assert/strict";
import { EXTENSION_ID, META_CLIENT_CAPABILITIES, clientCapabilities, expectedCircuitHash } from "@demo/protocol";
import { encryptArguments, VerifiableClient } from "@demo/client";
import { VerificationKeyRegistry } from "@demo/verifier";
import { generateKeyPairSync } from "node:crypto";
import { withServer, rpc } from "./helpers.js";
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
  const result = await client.callAndVerify("add", { a: 1, b: 2 }, "demo-sig-v1");
  const meta = result._meta?.[EXTENSION_ID];
  if (meta?.proof) meta.proof = `${meta.proof}00`;
  assert.equal(await client.verify(result, { a: 1, b: 2 }, "add"), false);
}));
test("tampered circuitHash does not verify in either format", async () => withServer(async (server) => {
  const client = new VerifiableClient(server.mcpUrl);
  await client.discover();
  for (const format of ["demo-sig-v1", "demo-commit-v1"]) {
    const result = await client.callTool("add", { a: 1, b: 2 }, format);
    if (result.resultType !== "complete" || !result._meta?.[EXTENSION_ID]) throw new Error("missing proof");
    result._meta[EXTENSION_ID].circuitHash = "0x" + "00".repeat(32);
    assert.equal(await client.verify(result, { a: 1, b: 2 }, "add"), false);
  }
}));
test("blind commitment mismatch is invalid params", async () => withServer(async (server) => {
  const client = new VerifiableClient(server.mcpUrl);
  const discovery = await client.discover();
  const encrypted = encryptArguments({ income: 100, debt: 20 }, discovery.blindPublicKey);
  const response = await rpc(server, "verifiable-tools/call", {
    tool: "privateCreditCheck",
    inputCommitment: "0x" + "00".repeat(32),
    encryptionScheme: "x25519-aesgcm-demo-v1",
    encryptedArguments: encrypted.encryptedArguments,
    proofFormat: "demo-sig-v1",
    _meta: { [META_CLIENT_CAPABILITIES]: clientCapabilities(["demo-sig-v1"], { blindExecution: true }) }
  });
  assert.equal(response.error?.code, -32602);
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
    await assert.rejects(() => Promise.all([
      registry.get("0xcircuit", "http://one"),
      registry.get("0xcircuit", "http://two")
    ]));
    assert.equal(fetchCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test("client rejects an unadvertised result format", async () => withServer(async (server) => {
  const client = new VerifiableClient(server.mcpUrl);
  await client.discover();
  const result = await client.callTool("add", { a: 1, b: 2 }, "demo-commit-v1");
  if (result.resultType !== "complete") throw new Error("unexpected task");
  client.setCapabilities({ proofFormats: ["demo-sig-v1"] });
  assert.equal(await client.verify(result, { a: 1, b: 2 }, "add"), false);
}));
test("invalid tool arguments are invalid params", async () => withServer(async (server) => {
  const response = await rpc(server, "tools/call", { name: "add", arguments: { a: "x", b: 2 } }, { "Mcp-Name": "add" });
  assert.equal(response.error?.code, -32602);
  const client = new VerifiableClient(server.mcpUrl);
  await client.discover();
  client.setCapabilities({ proofFormats: ["demo-sig-v1"] }, true);
  const task = await client.callTool("riskScore", { symbol: 1 }, "demo-sig-v1");
  assert.equal(task.resultType, "task");
  if (task.resultType !== "task") throw new Error("expected task");
  await new Promise<void>((resolve) => setTimeout(resolve, 350));
  const failed = await rpc(server, "tasks/get", { taskId: task.taskId }, {});
  assert.equal(failed.result?.status, "failed");
}));
test("foreign server-minted circuit is rejected", async () => withServer(async (server) => {
  const client = new VerifiableClient(server.mcpUrl);
  await client.discover();
  const result = await client.callTool("riskScore", { symbol: "AAPL" }, "demo-sig-v1");
  if (result.resultType !== "complete") throw new Error("unexpected task");
  assert.equal(result._meta?.[EXTENSION_ID]?.circuitHash, expectedCircuitHash("riskScore"));
  assert.equal(await client.verify(result, { symbol: "AAPL" }, "add"), false);
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
