import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { VerifiableClient } from "@demo/client";
import { DemoServer } from "@demo/server";
import { CallToolResult, EXTENSION_ID, META_CLIENT_CAPABILITIES, VerifiableToolsMeta, clientCapabilities, expectedCircuitHash, freshNonce } from "@demo/protocol";
import { mockNitroFixturesDir } from "@demo/prover";
import { TeeNitroVerifier, VerifyContext } from "@demo/verifier";
import { expectComplete, rpc, withServer, withServerOptions } from "./helpers.js";

const fixtures = mockNitroFixturesDir();
const ARGS = { a: 1, b: 2 };

function context(result: CallToolResult, nonce: string): VerifyContext {
  return { arguments: ARGS, content: result.content, nonce, expectedCircuitHash: expectedCircuitHash("add", "tee-nitro-v1") };
}

async function teeCall(server: DemoServer): Promise<{ client: VerifiableClient; result: CallToolResult; meta: VerifiableToolsMeta; nonce: string }> {
  const client = new VerifiableClient(server.mcpUrl);
  await client.discover();
  const call = await client.callTool("add", ARGS, { proofFormat: "tee-nitro-v1" });
  const result = expectComplete(call.result);
  return { client, result, meta: result._meta?.[EXTENSION_ID] as VerifiableToolsMeta, nonce: call.nonce };
}

test("tee-nitro-v1 happy path verifies and is advertised", async () => withServer(async (server) => {
  const { client, result, meta, nonce } = await teeCall(server);
  assert.equal(meta.proofFormat, "tee-nitro-v1");
  assert.equal(typeof meta.teeAttestation, "string");
  assert.equal(meta.verificationKeyUri, undefined);
  const descriptor = client.descriptor("add");
  assert.ok(descriptor?.proofFormats.includes("tee-nitro-v1"));
  assert.ok(descriptor?.formats && "tee-nitro-v1" in descriptor.formats);
  const verifier = TeeNitroVerifier.fromMockFixtures(fixtures);
  assert.deepEqual(await verifier.verifyDetailed(meta, context(result, nonce)), { ok: true });
}));

test("tee-nitro-v1 rejects mismatched measurement, root, user-data, nonce, staleness, and signature", async () => withServer(async (server) => {
  const { client, result, meta, nonce } = await teeCall(server);
  const ctx = context(result, nonce);

  const pcrs = JSON.parse(readFileSync(join(fixtures, "pcrs.json"), "utf8")) as Record<string, string>;
  const badMeasurement = TeeNitroVerifier.fromMockFixtures(fixtures, { pinnedPcrs: () => ({ ...pcrs, "0": "00".repeat(48) }) });
  assert.deepEqual(await badMeasurement.verifyDetailed(meta, ctx), { ok: false, reason: "measurementMismatch" });
  const noPins = TeeNitroVerifier.fromMockFixtures(fixtures, { pinnedPcrs: () => undefined });
  assert.deepEqual(await noPins.verifyDetailed(meta, ctx), { ok: false, reason: "measurementMismatch" });

  const wrongRoot = TeeNitroVerifier.fromMockFixtures(fixtures, { rootCertPem: readFileSync(join(fixtures, "untrusted-root.pem"), "utf8") });
  assert.deepEqual(await wrongRoot.verifyDetailed(meta, ctx), { ok: false, reason: "chainInvalid" });

  const badUserData = TeeNitroVerifier.fromMockFixtures(fixtures, { expectedUserData: () => new Uint8Array([9, 9, 9]) });
  assert.deepEqual(await badUserData.verifyDetailed(meta, ctx), { ok: false, reason: "userDataMismatch" });

  const replayed = await client.verify(result, ARGS, "add", { nonce: `0x${"11".repeat(16)}` });
  assert.equal(replayed.ok, false);
  if (!replayed.ok) assert.equal(replayed.reason, "nonceMismatch");

  const good = TeeNitroVerifier.fromMockFixtures(fixtures);
  const reused = await good.verifyDetailed(meta, context(result, freshNonce()));
  assert.deepEqual(reused, { ok: false, reason: "nonceMismatch" });

  const stale = TeeNitroVerifier.fromMockFixtures(fixtures, { now: () => Date.now() + 600_001 });
  assert.deepEqual(await stale.verifyDetailed(meta, ctx), { ok: false, reason: "attestationStale" });

  const other = generateKeyPairSync("ed25519");
  const message = Buffer.from(String(meta.circuitHash) + String(meta.inputCommitment) + String(meta.outputCommitment) + String(meta.nonce ?? "0x"));
  const forged: VerifiableToolsMeta = { ...meta, proof: `0x${sign(null, message, other.privateKey).toString("hex")}` };
  assert.deepEqual(await good.verifyDetailed(forged, ctx), { ok: false, reason: "signatureInvalid" });

  const malformed = { ...meta, teeAttestation: "0xdeadbeef" };
  assert.deepEqual(await good.verifyDetailed(malformed, ctx), { ok: false, reason: "attestationMalformed" });
}));

test("server with teeNitro disabled does not advertise or prove the format", async () => withServerOptions({ teeNitro: false }, async (server) => {
  const discovery = await rpc(server, "server/discover", {});
  const extension = (discovery.result?.capabilities as { extensions?: Record<string, { proofFormats?: string[] }> }).extensions?.[EXTENSION_ID];
  assert.equal(extension?.proofFormats?.includes("tee-nitro-v1"), false);
  const response = await rpc(server, "tools/call", {
    name: "add",
    arguments: ARGS,
    _meta: { [META_CLIENT_CAPABILITIES]: clientCapabilities(["tee-nitro-v1"], { requireProof: true }), [EXTENSION_ID]: { nonce: freshNonce() } }
  }, { "Mcp-Name": "add" });
  assert.equal(response.error?.code, -32602);
}));
