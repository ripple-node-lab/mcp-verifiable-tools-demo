import test from "node:test";
import assert from "node:assert/strict";
import { VerifiableClient } from "@demo/client";
import { withServer, withServerOptions, rpc } from "./helpers.js";
test("deferred price quote can be proved and expires", async () => withServerOptions({ resultTtlMs: 10 }, async (server) => {
  const client = new VerifiableClient(server.mcpUrl);
  await client.discover();
  const initial = await client.callTool("priceQuote", { symbol: "AAPL" });
  if (initial.result.resultType !== "complete") return;
  const resultId = initial.result._meta?.["io.modelcontextprotocol/verifiable-tools"]?.resultId;
  assert.equal(typeof resultId, "string");
  const proved = await client.prove(resultId as string, { proofFormat: "demo-sig-v1" });
  if (proved.result.resultType !== "complete") return;
  assert.equal(proved.result.content[0].text, initial.result.content[0].text);
  assert.equal((await client.verify(proved.result, { symbol: "AAPL" }, "priceQuote", { nonce: proved.nonce })).ok, true);
  await new Promise<void>((resolve) => setTimeout(resolve, 20));
  const expired = await rpc(server, "verifiable-tools/prove", { resultId });
  assert.equal(expired.error?.data?.reason, "resultExpired");
}));
test("requireProof proves price quote immediately", async () => withServer(async (server) => {
  const client = new VerifiableClient(server.mcpUrl);
  await client.discover();
  client.setCapabilities({ proofFormats: ["demo-sig-v1"], requireProof: true });
  const value = await client.callTool("priceQuote", { symbol: "AAPL" }, { proofFormat: "demo-sig-v1" });
  if (value.result.resultType !== "complete") return;
  assert.equal(value.result._meta?.["io.modelcontextprotocol/verifiable-tools"]?.resultId, undefined);
}));
