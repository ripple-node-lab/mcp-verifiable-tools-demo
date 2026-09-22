import test from "node:test";
import assert from "node:assert/strict";
import { VerifiableClient, encryptArguments } from "@demo/client";
import { EXTENSION_ID, HPKE_INFO_ARGS, META_CLIENT_CAPABILITIES, b64u, clientCapabilities, hpkeSeal, inputCommitment, jcs, unb64u } from "@demo/protocol";
import { withServer, rpc, expectComplete } from "./helpers.js";
test("binding rejects content mutation, replay nonce, and missing commitment", async () => withServer(async (server) => {
  const client = new VerifiableClient(server.mcpUrl);
  await client.discover();
  const first = await client.callTool("add", { a: 1, b: 2 }, { proofFormat: "demo-sig-v1" });
  const complete = expectComplete(first.result);
  const mutated = { ...complete, content: [{ type: "text" as const, text: "4" }] };
  const mutatedOutcome = await client.verify(mutated, { a: 1, b: 2 }, "add", { nonce: first.nonce });
  assert.equal(mutatedOutcome.ok, false);
  if (mutatedOutcome.ok) throw new Error("mutated output unexpectedly verified");
  assert.equal(mutatedOutcome.reason, "outputCommitmentMismatch");
  const replay = await client.verify(complete, { a: 1, b: 2 }, "add", { nonce: "0x5f1c3a9e7b2d4c6f8a1e0d3b5c7f9a2e" });
  assert.equal(replay.ok, false);
  if (replay.ok) throw new Error("replayed nonce unexpectedly verified");
  assert.equal(replay.reason, "nonceMismatch");
  const missing = { ...complete, _meta: { ...complete._meta, [EXTENSION_ID]: { ...complete._meta?.[EXTENSION_ID], outputCommitment: undefined } } };
  const missingOutcome = await client.verify(missing, { a: 1, b: 2 }, "add", { nonce: first.nonce });
  assert.equal(missingOutcome.ok, false);
  if (missingOutcome.ok) throw new Error("missing commitment unexpectedly verified");
  assert.equal(missingOutcome.reason, "missingCommitment");
}));
test("blind nonce validation rejects malformed requests", async () => withServer(async (server) => {
  const client = new VerifiableClient(server.mcpUrl);
  const discovery = await client.discover();
  const encrypted = encryptArguments({ income: 100, debt: 20 }, discovery.blindPublicKeys["hpke-v1"], "privateCreditCheck");
  const response = await rpc(server, "verifiable-tools/call", { tool: "privateCreditCheck", inputCommitment: encrypted.inputCommitment, encryptionScheme: "hpke-v1", encryptedArguments: encrypted.encryptedArguments, proofFormat: "demo-sig-v1", _meta: { [META_CLIENT_CAPABILITIES]: clientCapabilities(["demo-sig-v1"], { blindExecution: true }), [EXTENSION_ID]: { nonce: "0x123" } } });
  assert.equal(response.error?.code, -32602);
}));

test("blind calls reject short salts and mismatched commitments", async () => withServer(async (server) => {
  const client = new VerifiableClient(server.mcpUrl);
  const discovery = await client.discover();
  const args = { income: 100, debt: 20 };
  const shortSalt = new Uint8Array(31);
  const shortCommitment = inputCommitment(args, shortSalt);
  const shortPayload = new TextEncoder().encode(jcs({ salt: `0x${Buffer.from(shortSalt).toString("hex")}`, arguments: args }));
  const shortAad = new TextEncoder().encode(jcs({ tool: "privateCreditCheck", inputCommitment: shortCommitment, encryptionScheme: "hpke-v1" }));
  const shortEncrypted = b64u(hpkeSeal(unb64u(discovery.blindPublicKeys["hpke-v1"]), new TextEncoder().encode(HPKE_INFO_ARGS), shortAad, shortPayload));
  const base = { tool: "privateCreditCheck", encryptionScheme: "hpke-v1", proofFormat: "demo-sig-v1", _meta: { [META_CLIENT_CAPABILITIES]: clientCapabilities(["demo-sig-v1"], { blindExecution: true }) } };
  const shortResponse = await rpc(server, "verifiable-tools/call", { ...base, inputCommitment: shortCommitment, encryptedArguments: shortEncrypted });
  assert.equal(shortResponse.error?.code, -32602);
  const valid = encryptArguments(args, discovery.blindPublicKeys["hpke-v1"], "privateCreditCheck");
  const mismatch = await rpc(server, "verifiable-tools/call", { ...base, inputCommitment: "0x" + "00".repeat(32), encryptedArguments: valid.encryptedArguments });
  assert.equal(mismatch.error?.code, -32602);
}));

test("direct calls without a nonce use the empty public-input slot", async () => withServer(async (server) => {
  const response = await rpc(server, "tools/call", {
    name: "add",
    arguments: { a: 1, b: 2 },
    _meta: { [META_CLIENT_CAPABILITIES]: clientCapabilities(["demo-sig-v1"]) }
  }, { "Mcp-Name": "add" });
  const meta = response.result?._meta as Record<string, Record<string, unknown>>;
  const proofMeta = meta[EXTENSION_ID];
  assert.equal(proofMeta.nonce, undefined);
  assert.equal((proofMeta.publicInputs as unknown[])[2], "0x");
}));
