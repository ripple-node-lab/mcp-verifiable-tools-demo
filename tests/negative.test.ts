import test from "node:test";
import assert from "node:assert/strict";
import { VerifiableClient, encryptArguments } from "@demo/client";
import { EXTENSION_ID, META_CLIENT_CAPABILITIES, clientCapabilities } from "@demo/protocol";
import { withServer, rpc } from "./helpers.js";
test("invalid headers and nonce are rejected", async () => withServer(async (server) => {
  const invalidHeader = await rpc(server, "tools/call", { name: "add", arguments: { a: 1, b: 2 } }, { "Mcp-Method": "tools/list", "Mcp-Name": "add" });
  assert.equal(invalidHeader.error?.code, -32600);
  const invalidNonce = await rpc(server, "tools/call", { name: "add", arguments: { a: 1, b: 2 }, _meta: { [META_CLIENT_CAPABILITIES]: clientCapabilities(["demo-sig-v1"]), [EXTENSION_ID]: { nonce: "0x123" } } }, { "Mcp-Name": "add" });
  assert.equal(invalidNonce.error?.code, -32602);
}));
test("blind commitment mismatch is invalid params", async () => withServer(async (server) => {
  const client = new VerifiableClient(server.mcpUrl);
  const discovery = await client.discover();
  const encrypted = encryptArguments({ income: 100, debt: 20 }, discovery.blindPublicKeys["hpke-v1"]);
  const response = await rpc(server, "verifiable-tools/call", { tool: "privateCreditCheck", inputCommitment: "0x" + "00".repeat(32), encryptionScheme: "hpke-v1", encryptedArguments: encrypted.encryptedArguments, proofFormat: "demo-sig-v1", _meta: { [META_CLIENT_CAPABILITIES]: clientCapabilities(["demo-sig-v1"], { blindExecution: true }) } });
  assert.equal(response.error?.code, -32602);
}));
