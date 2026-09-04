import test from "node:test";
import assert from "node:assert/strict";
import { VerifiableClient } from "@demo/client";
import { clientCapabilities, META_CLIENT_CAPABILITIES } from "@demo/protocol";
import { withServer, rpc } from "./helpers.js";
test("riskScore is synchronous without tasks and asynchronous with tasks", async () => withServer(async (server) => {
  const plain = await rpc(server, "tools/call", { name: "riskScore", arguments: { symbol: "AAPL" }, _meta: { [META_CLIENT_CAPABILITIES]: clientCapabilities(["demo-sig-v1"]) } }, { "Mcp-Name": "riskScore" });
  assert.equal(plain.result?.resultType, "complete");
  const client = new VerifiableClient(server.mcpUrl);
  await client.discover();
  client.setCapabilities({ proofFormats: ["demo-sig-v1"] }, true);
  const task = await client.callTool("riskScore", { symbol: "AAPL" }, "demo-sig-v1");
  assert.equal(task.resultType, "task");
  const result = await client.callAndVerify("riskScore", { symbol: "AAPL" }, "demo-sig-v1");
  assert.equal(result.content[0].text, "86");
}));
