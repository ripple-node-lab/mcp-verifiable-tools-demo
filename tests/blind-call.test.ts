import test from "node:test";
import assert from "node:assert/strict";
import { VerifiableClient } from "@demo/client";
import { EXTENSION_ID } from "@demo/protocol";
import { withServer } from "./helpers.js";
test("blind private credit call supports encrypted replies", async () => withServer(async (server) => {
  const client = new VerifiableClient(server.mcpUrl);
  await client.discover();
  client.setCapabilities({ proofFormats: ["demo-sig-v1"], blindExecution: true });
  const result = await client.blindCall({ income: 100, debt: 20 }, { encryptReply: true });
  assert.equal(result.content[0].text, "approved");
  assert.equal(result._meta?.[EXTENSION_ID]?.encryptedContent, true);
}));
