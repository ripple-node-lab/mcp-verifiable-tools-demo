import test from "node:test";
import assert from "node:assert/strict";
import { VerifiableClient } from "@demo/client";
import { withServer } from "./helpers.js";
test("add proofs verify in both formats", async () => withServer(async (server) => {
  const client = new VerifiableClient(server.mcpUrl);
  await client.discover();
  for (const format of ["demo-sig-v1", "demo-commit-v1"]) {
    const result = await client.callAndVerify("add", { a: 10, b: 32 }, format);
    assert.equal(result.content[0].text, "42");
    assert.equal(result._meta?.["io.modelcontextprotocol/verifiable-tools"]?.outputCommitment !== undefined, true);
  }
}));
