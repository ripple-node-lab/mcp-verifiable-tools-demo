import test from "node:test";
import assert from "node:assert/strict";
import { EXTENSION_ID, META_CLIENT_CAPABILITIES, clientCapabilities } from "@demo/protocol";
import { VerifiableClient } from "@demo/client";
import { withServer, rpc } from "./helpers.js";
test("invalid HTTP method header is rejected", async () => withServer(async (server) => {
  const response = await rpc(server, "tools/call", { name: "add", arguments: { a: 1, b: 2 } }, { "Mcp-Method": "tools/list", "Mcp-Name": "add" });
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
  assert.equal(await client.verify(result, { a: 1, b: 2 }), false);
}));
