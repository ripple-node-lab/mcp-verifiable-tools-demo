import test from "node:test";
import assert from "node:assert/strict";
import { EXTENSION_ID, META_CLIENT_CAPABILITIES, clientCapabilities } from "@demo/protocol";
import { VerifiableClient } from "@demo/client";
import { withServer, rpc } from "./helpers.js";
test("negotiation controls evidence metadata", async () => withServer(async (server) => {
  const plain = await rpc(server, "tools/call", { name: "add", arguments: { a: 1, b: 2 }, _meta: {} }, { "Mcp-Name": "add" });
  assert.equal(plain.result?._meta, undefined);
  const meta = { [META_CLIENT_CAPABILITIES]: clientCapabilities(["demo-sig-v1"]) };
  const verified = await rpc(server, "tools/call", { name: "add", arguments: { a: 1, b: 2 }, _meta: meta }, { "Mcp-Name": "add" });
  assert.equal((verified.result?._meta as Record<string, unknown>)[EXTENSION_ID] !== undefined, true);
  const rejected = await rpc(server, "tools/call", { name: "add", arguments: { a: 1, b: 2 }, _meta: { [META_CLIENT_CAPABILITIES]: clientCapabilities(["unknown"], { requireProof: true }) } }, { "Mcp-Name": "add" });
  assert.equal(rejected.error?.code, -32602);
  void VerifiableClient;
}));
