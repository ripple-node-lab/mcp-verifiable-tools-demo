import test from "node:test";
import assert from "node:assert/strict";
import { VerifiableClient } from "@demo/client";
import { withServer, withServerOptions, rpc, expectComplete } from "./helpers.js";
test("deferred price quote can be proved and expires", async () => withServerOptions({ resultTtlMs: 10 }, async (server) => {
  const client = new VerifiableClient(server.mcpUrl);
  await client.discover();
  const initial = await client.callTool("priceQuote", { symbol: "AAPL" });
  const initialResult = expectComplete(initial.result);
  const resultId = initialResult._meta?.["io.modelcontextprotocol/verifiable-tools"]?.resultId;
  assert.equal(typeof resultId, "string");
  const proved = await client.prove(resultId as string, { proofFormat: "demo-sig-v1" });
  const provedResult = expectComplete(proved.result);
  assert.equal(provedResult.content[0].text, initialResult.content[0].text);
  assert.equal((await client.verify(provedResult, { symbol: "AAPL" }, "priceQuote", { nonce: proved.nonce })).ok, true);
  await new Promise<void>((resolve) => setTimeout(resolve, 20));
  const expired = await rpc(server, "verifiable-tools/prove", { resultId });
  assert.equal(expired.error?.data?.reason, "resultExpired");
}));
test("plain price quotes do not retain deferred witnesses without capability", async () => withServer(async (server) => {
  const response = await rpc(server, "tools/call", { name: "priceQuote", arguments: { symbol: "AAPL" } }, { "Mcp-Name": "priceQuote" });
  const result = expectComplete(response.result as never);
  assert.equal(result._meta?.["io.modelcontextprotocol/verifiable-tools"], undefined);
}));
test("expired deferred witnesses are swept without traffic", async () => withServerOptions({ resultTtlMs: 50 }, async (server) => {
  const client = new VerifiableClient(server.mcpUrl);
  await client.discover();
  const initial = expectComplete((await client.callTool("priceQuote", { symbol: "AAPL" })).result);
  const resultId = initial._meta?.["io.modelcontextprotocol/verifiable-tools"]?.resultId;
  assert.equal(typeof resultId, "string");
  await new Promise<void>((resolve) => setTimeout(resolve, 120));
  assert.equal(server.results.witnessCount, 0);
  const expired = await rpc(server, "verifiable-tools/prove", { resultId });
  assert.equal(expired.error?.data?.reason, "resultExpired");
}));

test("unknown deferred result IDs and unsupported formats are rejected", async () => withServer(async (server) => {
  const unknown = await rpc(server, "verifiable-tools/prove", { resultId: "00".repeat(16) });
  assert.equal(unknown.error?.code, -32602);
  assert.equal(unknown.error?.data?.reason, "resultNotFound");
  const client = new VerifiableClient(server.mcpUrl);
  await client.discover();
  const initial = expectComplete((await client.callTool("priceQuote", { symbol: "AAPL" })).result);
  const resultId = initial._meta?.["io.modelcontextprotocol/verifiable-tools"]?.resultId;
  assert.equal(typeof resultId, "string");
  const unsupported = await rpc(server, "verifiable-tools/prove", { resultId, proofFormat: "unknown-format" });
  assert.equal(unsupported.error?.code, -32602);
}));
test("requireProof proves price quote immediately", async () => withServer(async (server) => {
  const client = new VerifiableClient(server.mcpUrl);
  await client.discover();
  client.setCapabilities({ proofFormats: ["demo-sig-v1"], requireProof: true });
  const value = await client.callTool("priceQuote", { symbol: "AAPL" }, { proofFormat: "demo-sig-v1" });
  const result = expectComplete(value.result);
  assert.equal(result._meta?.["io.modelcontextprotocol/verifiable-tools"]?.resultId, undefined);
}));
