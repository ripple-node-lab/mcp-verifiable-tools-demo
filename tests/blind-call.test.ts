import test from "node:test";
import assert from "node:assert/strict";
import { VerifiableClient } from "@demo/client";
import { withServer } from "./helpers.js";
test("blind private credit call works without Mcp-Name", async () => withServer(async (server) => {
  const client = new VerifiableClient(server.mcpUrl);
  await client.discover();
  const result = await client.blindCall({ income: 100, debt: 20 });
  assert.equal(result.content[0].text, "approved");
}));
