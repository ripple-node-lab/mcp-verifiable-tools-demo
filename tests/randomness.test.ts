import assert from "node:assert/strict";
import test from "node:test";
import { EXTENSION_ID } from "@demo/protocol";
import { VerifiableClient } from "@demo/client";
import { withServer, expectComplete } from "./helpers.js";

test("identical ZK calls produce different proof encodings", async () => {
  await withServer(async (server) => {
    const client = new VerifiableClient(server.mcpUrl);
    const discovery = await client.discover();
    client.setCapabilities({ proofFormats: discovery.proofFormats });
    for (const format of ["snarkjs-v2", "noir-v1"]) {
      const first = await client.callTool("add", { a: 20, b: 22 }, { proofFormat: format });
      const second = await client.callTool("add", { a: 20, b: 22 }, { proofFormat: format });
      const one = expectComplete(first.result);
      const two = expectComplete(second.result);
      assert.notEqual(one._meta?.[EXTENSION_ID]?.proof, two._meta?.[EXTENSION_ID]?.proof);
      assert.equal((await client.verify(one, { a: 20, b: 22 }, "add", { nonce: first.nonce })).ok, true);
      assert.equal((await client.verify(two, { a: 20, b: 22 }, "add", { nonce: second.nonce })).ok, true);
    }
  });
});
