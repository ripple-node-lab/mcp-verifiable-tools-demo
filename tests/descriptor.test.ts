import test from "node:test";
import assert from "node:assert/strict";
import { VerifiableClient } from "@demo/client";
import { expectedCircuitHash } from "@demo/protocol";
import { withServer } from "./helpers.js";
test("discovery stores and validates descriptors", async () => withServer(async (server) => {
  const client = new VerifiableClient(server.mcpUrl);
  await client.discover();
  assert.equal(client.descriptor("add")?.proofPolicy, "always");
}));
test("descriptor circuit hash mismatch is rejected", async () => withServer(async (server) => {
  const client = new VerifiableClient(server.mcpUrl);
  const original = server.dispatch.bind(server);
  server.dispatch = async (request) => {
    const response = await original(request);
    if (request.method === "tools/list" && response.result && typeof response.result === "object") {
      const result = response.result as { tools: Array<{ _meta: Record<string, Record<string, unknown>> }> };
      result.tools[0]._meta["io.modelcontextprotocol/verifiable-tools"].circuitHash = expectedCircuitHash("riskScore");
    }
    return response;
  };
  await assert.rejects(() => client.discover());
}));
