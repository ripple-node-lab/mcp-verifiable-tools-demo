import test from "node:test";
import assert from "node:assert/strict";
import { VerifiableClient, encryptArguments } from "@demo/client";
import { EXTENSION_ID, META_CLIENT_CAPABILITIES, clientCapabilities } from "@demo/protocol";
import { withServer, rpc } from "./helpers.js";
test("binding rejects content mutation, replay nonce, and missing commitment", async () => withServer(async (server) => {
  const client = new VerifiableClient(server.mcpUrl);
  await client.discover();
  const first = await client.callTool("add", { a: 1, b: 2 }, { proofFormat: "demo-sig-v1" });
  if (first.result.resultType !== "complete") return;
  const mutated = { ...first.result, content: [{ type: "text" as const, text: "4" }] };
  assert.equal((await client.verify(mutated, { a: 1, b: 2 }, "add", { nonce: first.nonce }) as { reason?: string }).reason, "outputCommitmentMismatch");
  assert.equal((await client.verify(first.result, { a: 1, b: 2 }, "add", { nonce: "0x5f1c3a9e7b2d4c6f8a1e0d3b5c7f9a2e" }) as { reason?: string }).reason, "nonceMismatch");
  const missing = { ...first.result, _meta: { ...first.result._meta, [EXTENSION_ID]: { ...first.result._meta?.[EXTENSION_ID], outputCommitment: undefined } } };
  assert.equal((await client.verify(missing, { a: 1, b: 2 }, "add", { nonce: first.nonce }) as { reason?: string }).reason, "missingCommitment");
}));
test("blind nonce validation rejects malformed requests", async () => withServer(async (server) => {
  const client = new VerifiableClient(server.mcpUrl);
  const discovery = await client.discover();
  const encrypted = encryptArguments({ income: 100, debt: 20 }, discovery.blindPublicKeys["hpke-v1"]);
  const response = await rpc(server, "verifiable-tools/call", { tool: "privateCreditCheck", inputCommitment: encrypted.inputCommitment, encryptionScheme: "hpke-v1", encryptedArguments: encrypted.encryptedArguments, proofFormat: "demo-sig-v1", _meta: { [META_CLIENT_CAPABILITIES]: clientCapabilities(["demo-sig-v1"], { blindExecution: true }), [EXTENSION_ID]: { nonce: "0x123" } } });
  assert.equal(response.error?.code, -32602);
}));
