import test from "node:test";
import assert from "node:assert/strict";
import { encryptArguments, VerifiableClient } from "@demo/client";
import { EXTENSION_ID } from "@demo/protocol";
import { withServer } from "./helpers.js";
test("blind private credit call works without Mcp-Name", async () => withServer(async (server) => {
  const client = new VerifiableClient(server.mcpUrl);
  await client.discover();
  client.setCapabilities({ proofFormats: ["demo-sig-v1"], blindExecution: true });
  const args = { income: 100, debt: 20 };
  const encrypted = encryptArguments(args, (await client.discover()).blindPublicKey);
  const result = await client.blindCall(args);
  assert.equal(result.content[0].text, "approved");
  assert.equal(result._meta?.[EXTENSION_ID]?.inputCommitment, encrypted.inputCommitment);
}));
