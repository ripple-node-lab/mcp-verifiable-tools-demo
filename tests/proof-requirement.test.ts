import test from "node:test";
import assert from "node:assert/strict";
import { EXTENSION_ID, META_CLIENT_CAPABILITIES, clientCapabilities } from "@demo/protocol";
import { VerifiableClient } from "@demo/client";
import type { Prover } from "@demo/prover";
import { withServer, withServerOptions, rpc, expectComplete } from "./helpers.js";

test("required rejects calls without a mutually supported format", async () => withServer(async (server) => {
  const response = await rpc(server, "tools/call", {
    name: "add",
    arguments: { a: 1, b: 2 },
    _meta: { [META_CLIENT_CAPABILITIES]: clientCapabilities(["unknown"], { requireProof: true }) }
  }, { "Mcp-Name": "add" });
  assert.equal(response.error?.code, -32602);
  assert.equal(response.error?.data?.reason, "noProofFormat");
}));

test("per-call requirement overrides the capability default", async () => withServer(async (server) => {
  const required = await rpc(server, "tools/call", {
    name: "add",
    arguments: { a: 1, b: 2 },
    _meta: {
      [META_CLIENT_CAPABILITIES]: clientCapabilities(["unknown"]),
      [EXTENSION_ID]: { proofRequirement: "required" }
    }
  }, { "Mcp-Name": "add" });
  assert.equal(required.error?.code, -32602);
  assert.equal(required.error?.data?.reason, "noProofFormat");

  const preferred = await rpc(server, "tools/call", {
    name: "add",
    arguments: { a: 1, b: 2 },
    _meta: {
      [META_CLIENT_CAPABILITIES]: clientCapabilities(["unknown"], { requireProof: true }),
      [EXTENSION_ID]: { proofRequirement: "preferred" }
    }
  }, { "Mcp-Name": "add" });
  assert.equal(preferred.error, undefined);
  assert.equal(expectComplete(preferred.result as never).content[0].text, "3");
}));

test("required reports proofUnavailable and preferred surfaces absent evidence", async () => {
  const failingProver: Prover = {
    format: "demo-sig-v1",
    async prove(): Promise<never> {
      throw new Error("prover failed");
    }
  };
  await withServerOptions({ proverOverrides: new Map([["demo-sig-v1", failingProver]]) }, async (server) => {
    const required = await rpc(server, "tools/call", {
      name: "add",
      arguments: { a: 1, b: 2 },
      _meta: {
        [META_CLIENT_CAPABILITIES]: clientCapabilities(["demo-sig-v1"]),
        [EXTENSION_ID]: { proofRequirement: "required" }
      }
    }, { "Mcp-Name": "add" });
    assert.equal(required.error?.code, -32603);
    assert.equal(required.error?.data?.reason, "proofUnavailable");

    const client = new VerifiableClient(server.mcpUrl);
    await client.discover();
    const call = await client.callTool("add", { a: 1, b: 2 }, { proofFormat: "demo-sig-v1", proofRequirement: "preferred" });
    const result = expectComplete(call.result);
    assert.equal(result._meta?.[EXTENSION_ID], undefined);
    const outcome = await client.verifyWithRequirement(result, { a: 1, b: 2 }, "add", { nonce: call.nonce, proofRequirement: "preferred" });
    assert.deepEqual(outcome, { outcome: "absent", requirement: "preferred", act: false, reason: "noProof", descriptorViolation: true });
  });
});

test("preferred price quotes remain actionable with a deferred result", async () => withServer(async (server) => {
  const client = new VerifiableClient(server.mcpUrl);
  await client.discover();
  const call = await client.callTool("priceQuote", { symbol: "AAPL" }, { proofFormat: "demo-sig-v1", proofRequirement: "preferred" });
  const result = expectComplete(call.result);
  assert.equal(typeof result._meta?.[EXTENSION_ID]?.resultId, "string");
  const outcome = await client.verifyWithRequirement(result, { symbol: "AAPL" }, "priceQuote", { nonce: call.nonce, proofRequirement: "preferred" });
  assert.deepEqual(outcome, { outcome: "absent", requirement: "preferred", act: true, reason: "noProof", descriptorViolation: false });
}));

test("callAndVerify rejects preferred absent deferred results", async () => withServer(async (server) => {
  const client = new VerifiableClient(server.mcpUrl);
  await client.discover();
  await assert.rejects(() => client.callAndVerify("priceQuote", { symbol: "AAPL" }, "demo-sig-v1", "preferred"));
}));

test("preferred absent evidence violates an always descriptor", async () => withServer(async (server) => {
  const client = new VerifiableClient(server.mcpUrl);
  await client.discover();
  const call = await client.callTool("add", { a: 1, b: 2 }, { proofFormat: "demo-sig-v1", proofRequirement: "preferred" });
  const result = expectComplete(call.result);
  delete result._meta;
  const outcome = await client.verifyWithRequirement(result, { a: 1, b: 2 }, "add", { nonce: call.nonce, proofRequirement: "preferred" });
  assert.deepEqual(outcome, { outcome: "absent", requirement: "preferred", act: false, reason: "noProof", descriptorViolation: true });
}));

test("preferred tampered content is invalid and not actionable", async () => withServer(async (server) => {
  const client = new VerifiableClient(server.mcpUrl);
  await client.discover();
  const call = await client.callTool("add", { a: 1, b: 2 }, { proofFormat: "demo-sig-v1", proofRequirement: "preferred" });
  const result = expectComplete(call.result);
  result.content[0].text = "4";
  const outcome = await client.verifyWithRequirement(result, { a: 1, b: 2 }, "add", { nonce: call.nonce, proofRequirement: "preferred" });
  assert.deepEqual(outcome, { outcome: "invalid", requirement: "preferred", act: false, reason: "outputCommitmentMismatch", descriptorViolation: false });
}));

test("none skips verification and asks the server for no proof", async () => withServer(async (server) => {
  const client = new VerifiableClient(server.mcpUrl);
  await client.discover();
  const call = await client.callTool("add", { a: 1, b: 2 }, { proofFormat: "demo-sig-v1", proofRequirement: "none" });
  const result = expectComplete(call.result);
  assert.equal(result._meta, undefined);
  const outcome = await client.verifyWithRequirement(result, { a: 1, b: 2 }, "add", { nonce: call.nonce, proofRequirement: "none" });
  assert.deepEqual(outcome, { outcome: "absent", requirement: "none", act: true, reason: "notEvaluated", descriptorViolation: false });
}));

test("none price quotes do not retain deferred results", async () => withServer(async (server) => {
  const client = new VerifiableClient(server.mcpUrl);
  await client.discover();
  const call = await client.callTool("priceQuote", { symbol: "AAPL" }, { proofFormat: "demo-sig-v1", proofRequirement: "none" });
  const result = expectComplete(call.result);
  assert.equal(result._meta?.[EXTENSION_ID]?.resultId, undefined);
}));

test("preferred proven results are verified and actionable", async () => withServer(async (server) => {
  const client = new VerifiableClient(server.mcpUrl);
  await client.discover();
  const call = await client.callTool("add", { a: 1, b: 2 }, { proofFormat: "demo-sig-v1", proofRequirement: "preferred" });
  const result = expectComplete(call.result);
  const outcome = await client.verifyWithRequirement(result, { a: 1, b: 2 }, "add", { nonce: call.nonce, proofRequirement: "preferred" });
  assert.deepEqual(outcome, { outcome: "verified", requirement: "preferred", act: true, descriptorViolation: false });
}));

test("evidence without proofFormat is invalid, not absent", async () => withServer(async (server) => {
  const client = new VerifiableClient(server.mcpUrl);
  await client.discover();
  const call = await client.callTool("priceQuote", { symbol: "AAPL" }, { proofFormat: "demo-sig-v1", proofRequirement: "preferred" });
  const result = expectComplete(call.result);
  result._meta![EXTENSION_ID] = { ...result._meta![EXTENSION_ID], proof: "00" };
  const outcome = await client.verifyWithRequirement(result, { symbol: "AAPL" }, "priceQuote", { nonce: call.nonce, proofRequirement: "preferred" });
  assert.deepEqual(outcome, { outcome: "invalid", requirement: "preferred", act: false, reason: "formatNotNegotiated", descriptorViolation: false });
}));

test("a resultId from a server that advertises no resultTtlMs is a descriptor violation", async () => withServer(async (server) => {
  const client = new VerifiableClient(server.mcpUrl);
  const discovered = await client.discover();
  delete discovered.resultTtlMs;
  const call = await client.callTool("priceQuote", { symbol: "AAPL" }, { proofFormat: "demo-sig-v1", proofRequirement: "preferred" });
  const result = expectComplete(call.result);
  assert.equal(typeof result._meta?.[EXTENSION_ID]?.resultId, "string");
  const outcome = await client.verifyWithRequirement(result, { symbol: "AAPL" }, "priceQuote", { nonce: call.nonce, proofRequirement: "preferred" });
  assert.deepEqual(outcome, { outcome: "absent", requirement: "preferred", act: false, reason: "noProof", descriptorViolation: true });
}));
