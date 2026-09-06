import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { VerifiableClient } from "@demo/client";
import {
  CallToolResult, InputAttestation, META_CLIENT_CAPABILITIES, VerifiableToolsMeta,
  attestationCommitment, clientCapabilities, jcs
} from "@demo/protocol";
import { OracleSigVerifier, verifyResult } from "@demo/verifier";
import { withServer, withServerOptions, rpc, expectComplete } from "./helpers.js";

const EXT = "io.modelcontextprotocol/verifiable-tools";

function meta(result: CallToolResult): VerifiableToolsMeta {
  const value = result._meta?.[EXT] as VerifiableToolsMeta | undefined;
  if (!value) throw new Error("expected verifiable-tools meta");
  return value;
}

// Recompute a demo-commit-v1 proof after mutating publicInputs (demo crypto:
// proof = "0x" + sha256(circuitHash + JSON.stringify(publicInputs))).
function reseal(value: VerifiableToolsMeta): VerifiableToolsMeta {
  value.proof = `0x${createHash("sha256").update(value.circuitHash! + JSON.stringify(value.publicInputs)).digest("hex")}`;
  return value;
}

async function riskScoreCall(serverUrl: string, format = "demo-commit-v1"): Promise<{ client: VerifiableClient; result: CallToolResult; nonce: string }> {
  const client = new VerifiableClient(serverUrl);
  await client.discover();
  client.setCapabilities({ proofFormats: [format], requireInputProvenance: true });
  const call = await client.callTool("riskScore", { symbol: "AAPL" }, { proofFormat: format });
  return { client, result: expectComplete(call.result), nonce: call.nonce };
}

test("riskScore with requireInputProvenance verifies and binds the attestation", async () => withServer(async (server) => {
  const { client, result, nonce } = await riskScoreCall(server.mcpUrl);
  const value = meta(result);
  assert.equal(value.inputAttestations?.[0]?.type, "oracle-sig-v1");
  assert.equal(value.inputAttestations?.length, 1);
  const commitment = value.inputAttestations![0].commitment;
  assert.equal(value.publicInputs?.[value.publicInputs.length - 1], commitment);
  const outcome = await client.verify(result, { symbol: "AAPL" }, "riskScore", { nonce });
  assert.deepEqual(outcome, { ok: true });
}));

test("missing attestations give provenanceMissing when required, ok otherwise", async () => withServer(async (server) => {
  const { client, result, nonce } = await riskScoreCall(server.mcpUrl);
  const value = structuredClone(meta(result));
  delete value.inputAttestations;
  value.publicInputs = value.publicInputs?.slice(0, 4);
  result._meta![EXT] = reseal(value) as never;
  client.setCapabilities({ proofFormats: ["demo-commit-v1"] });
  assert.deepEqual(await client.verify(result, { symbol: "AAPL" }, "riskScore", { nonce }), { ok: true });
  client.setCapabilities({ proofFormats: ["demo-commit-v1"], requireInputProvenance: true });
  assert.deepEqual(await client.verify(result, { symbol: "AAPL" }, "riskScore", { nonce }), { ok: false, reason: "provenanceMissing" });
}));

test("tampered attestation data yields provenanceInvalid", async () => withServer(async (server) => {
  const { client, result, nonce } = await riskScoreCall(server.mcpUrl);
  const value = structuredClone(meta(result));
  value.inputAttestations![0].data = '{"currency":"USD","price":999,"symbol":"AAPL"}';
  result._meta![EXT] = reseal(value) as never;
  const outcome = await client.verify(result, { symbol: "AAPL" }, "riskScore", { nonce });
  assert.deepEqual(outcome, { ok: false, reason: "provenanceInvalid" });
}));

test("a commitment not bound in publicInputs yields provenanceUnbound", async () => withServer(async (server) => {
  const { result, nonce } = await riskScoreCall(server.mcpUrl);
  const value = structuredClone(meta(result));
  value.inputAttestations![0].commitment = `0x${createHash("sha256").update("other").digest("hex")}`;
  // Demo verifiers derive the publicInputs tail from inputAttestations, so an
  // unbound commitment is already proofInvalid for them; exercise verifyResult
  // with a pass-through format verifier to isolate the provenance check.
  const outcome = await verifyResult(value, {
    arguments: { symbol: "AAPL" }, content: result.content, nonce,
    expectedCircuitHash: value.circuitHash!
  }, [{ format: value.proofFormat!, verify: () => Promise.resolve(true) }],
    { required: true, verifiers: [new OracleSigVerifier()] });
  assert.deepEqual(outcome, { ok: false, reason: "provenanceUnbound" });
}));

test("a consistent commitment swap invalidates the bound proof", async () => withServer(async (server) => {
  const forged = `0x${createHash("sha256").update("forged").digest("hex")}`;
  for (const format of ["demo-commit-v1", "demo-sig-v1"]) {
    const { client, result, nonce } = await riskScoreCall(server.mcpUrl, format);
    const value = structuredClone(meta(result));
    value.inputAttestations![0].commitment = forged;
    value.publicInputs![value.publicInputs!.length - 1] = forged;
    result._meta![EXT] = value as never;
    const outcome = await client.verify(result, { symbol: "AAPL" }, "riskScore", { nonce });
    assert.deepEqual(outcome, { ok: false, reason: "proofInvalid" });
  }
}));

test("an unknown attestation type yields provenanceUnsupported", async () => withServer(async (server) => {
  const { client, result, nonce } = await riskScoreCall(server.mcpUrl);
  const value = structuredClone(meta(result));
  value.inputAttestations![0].type = "unknown-type-v1";
  result._meta![EXT] = reseal(value) as never;
  const outcome = await client.verify(result, { symbol: "AAPL" }, "riskScore", { nonce });
  assert.deepEqual(outcome, { ok: false, reason: "provenanceUnsupported" });
}));

test("a malformed attestation entry yields provenanceMalformed", async () => withServer(async (server) => {
  const { client, result, nonce } = await riskScoreCall(server.mcpUrl);
  const value = structuredClone(meta(result));
  (value.inputAttestations![0] as unknown as Record<string, unknown>).data = 123;
  result._meta![EXT] = reseal(value) as never;
  const outcome = await client.verify(result, { symbol: "AAPL" }, "riskScore", { nonce });
  assert.deepEqual(outcome, { ok: false, reason: "provenanceMalformed" });
}));

test("add with requireInputProvenance verifies without attestations", async () => withServer(async (server) => {
  const client = new VerifiableClient(server.mcpUrl);
  await client.discover();
  client.setCapabilities({ proofFormats: ["demo-commit-v1"], requireInputProvenance: true });
  const result = await client.callAndVerify("add", { a: 20, b: 22 }, "demo-commit-v1");
  assert.equal(meta(result).inputAttestations, undefined);
  assert.equal(result.content[0].text, "42");
}));

test("a forged oracle signature yields provenanceInvalid", async () => withServer(async (server) => {
  const { client, result, nonce } = await riskScoreCall(server.mcpUrl);
  const value = structuredClone(meta(result));
  const attestation = value.inputAttestations![0];
  const forged = generateKeyPairSync("ed25519");
  const message = new TextEncoder().encode(jcs({ type: attestation.type, source: attestation.source, commitment: attestation.commitment } as never));
  attestation.proof = sign(null, message, forged.privateKey).toString("base64url");
  result._meta![EXT] = reseal(value) as never;
  const outcome = await client.verify(result, { symbol: "AAPL" }, "riskScore", { nonce });
  assert.deepEqual(outcome, { ok: false, reason: "provenanceInvalid" });
}));

test("feed failure with requireInputProvenance returns -32603", async () => withServerOptions({
  priceFeed: { fetch: () => Promise.reject(new Error("oracle down")) }
}, async (server) => {
  const required = await rpc(server, "tools/call", {
    name: "riskScore", arguments: { symbol: "AAPL" },
    _meta: { [META_CLIENT_CAPABILITIES]: clientCapabilities(["demo-sig-v1"], { requireInputProvenance: true }) }
  }, { "Mcp-Name": "riskScore" });
  assert.equal(required.error?.code, -32603);
  assert.equal(required.error?.message, "input provenance unavailable");
}));

test("attestation commitment equals sha256 of data", () => {
  const data = jcs({ symbol: "AAPL", price: 386, currency: "USD" } as never);
  assert.equal(attestationCommitment(data), `0x${createHash("sha256").update(data).digest("hex")}`);
});
