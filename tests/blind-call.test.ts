import test from "node:test";
import assert from "node:assert/strict";
import { encryptArguments, generateReplyKeyPair, VerifiableClient } from "@demo/client";
import { EXTENSION_ID, META_CLIENT_CAPABILITIES, b64u, clientCapabilities, freshNonce } from "@demo/protocol";
import { withServer, rpc } from "./helpers.js";
test("blind private credit call works without Mcp-Name", async () => withServer(async (server) => {
  const client = new VerifiableClient(server.mcpUrl);
  await client.discover();
  client.setCapabilities({ proofFormats: ["demo-sig-v1"], blindExecution: true });
  const result = await client.blindCall({ income: 100, debt: 20 });
  assert.equal(result.content[0].text, "approved");
  assert.equal(typeof result._meta?.[EXTENSION_ID]?.inputCommitment, "string");
}));
test("blind private credit call supports encrypted replies", async () => withServer(async (server) => {
  const client = new VerifiableClient(server.mcpUrl);
  await client.discover();
  client.setCapabilities({ proofFormats: ["demo-sig-v1"], blindExecution: true });
  const encrypted = encryptArguments({ income: 100, debt: 20 }, (await client.discover()).blindPublicKeys["hpke-v1"], "privateCreditCheck");
  const reply = generateReplyKeyPair();
  const nonce = freshNonce();
  const wire = await rpc(server, "verifiable-tools/call", {
    tool: "privateCreditCheck",
    inputCommitment: encrypted.inputCommitment,
    encryptionScheme: "hpke-v1",
    encryptedArguments: encrypted.encryptedArguments,
    proofFormat: "demo-sig-v1",
    replyPublicKey: b64u(reply.publicKey),
    _meta: { [META_CLIENT_CAPABILITIES]: clientCapabilities(["demo-sig-v1"], { blindExecution: true }), [EXTENSION_ID]: { nonce } }
  });
  assert.equal(wire.result?._meta && (wire.result._meta as Record<string, unknown>)[EXTENSION_ID] !== undefined, true);
  assert.equal((wire.result?.content as Array<{ text: string }>)[0].text === "approved", false);
  const result = await client.blindCall({ income: 100, debt: 20 }, { encryptReply: true });
  assert.equal(result.content[0].text, "approved");
  assert.equal(result._meta?.[EXTENSION_ID]?.encryptedContent, true);
}));
