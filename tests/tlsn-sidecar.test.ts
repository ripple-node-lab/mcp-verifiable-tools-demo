// Requires a running zktls-tlsn-v1 sidecar (docker compose --profile tlsn).
//   TLSN_SIDECAR_URL=http://127.0.0.1:4400 node --test tests/dist/tlsn-sidecar.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { createPublicKey, generateKeyPairSync } from "node:crypto";
import { VerifiableClient } from "@demo/client";
import { TlsnProvenanceVerifier } from "@demo/prover-sidecar";
import { EXTENSION_ID, VerifiableToolsMeta } from "@demo/protocol";
import { withServerOptions, expectComplete } from "./helpers.js";

const SIDECAR = process.env.TLSN_SIDECAR_URL;
if (!SIDECAR) console.log("skipping tlsn sidecar tests (TLSN_SIDECAR_URL unset)");
const run = (name: string, fn: () => void | Promise<void>): void => { if (SIDECAR) test(name, fn); };
const VERIFIER = () => new TlsnProvenanceVerifier({ baseUrl: SIDECAR! });
// node-shim only types the one-arg overload; secp256k1 needs options.
const generateSecp256k1 = generateKeyPairSync as unknown as (type: string, options: unknown) => { publicKey: { export(options: unknown): unknown } };

async function tlsnVerify(attestation: unknown, notaryKeyPem: string): Promise<{ ok: boolean; serverName?: string; data?: string; reason?: string }> {
  const response = await fetch(`${SIDECAR}/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ attestation, notaryKeyPem })
  });
  return await response.json() as { ok: boolean; serverName?: string; data?: string };
}

run("healthz and /notary-key serve a usable secp256k1 PEM", async () => {
  const health = await fetch(`${SIDECAR}/healthz`).then((r) => r.json() as Promise<Record<string, unknown>>);
  assert.equal(health.status, "ok");
  assert.deepEqual(health.types, ["zktls-tlsn-v1"]);
  assert.equal(health.notaryKeyUri, `${SIDECAR}/notary-key`);
  const pem = await fetch(`${SIDECAR}/notary-key`).then((r) => r.text());
  assert.ok(pem.includes("BEGIN PUBLIC KEY"));
  const key = createPublicKey({ key: pem, format: "pem" });
  assert.ok(key);
});

run("riskScore via TlsnPriceFeed verifies with requireInputProvenance", async () => withServerOptions({ tlsnSidecarUrl: SIDECAR }, async (server) => {
  const client = new VerifiableClient(server.mcpUrl, { allowedKeyOrigins: [new URL(SIDECAR!).origin] });
  await client.discover();
  client.addProvenanceVerifier(VERIFIER());
  client.setCapabilities({ proofFormats: ["demo-commit-v1"], requireInputProvenance: true });
  const call = await client.callTool("riskScore", { symbol: "AAPL" }, { proofFormat: "demo-commit-v1" });
  const result = expectComplete(call.result);
  const meta = result._meta?.[EXTENSION_ID] as VerifiableToolsMeta | undefined;
  assert.equal(meta?.inputAttestations?.[0]?.type, "zktls-tlsn-v1");
  const commitment = meta?.inputAttestations?.[0]?.commitment;
  assert.equal(meta?.publicInputs?.[meta.publicInputs.length - 1], commitment);
  const outcome = await client.verify(result, { symbol: "AAPL" }, "riskScore", { nonce: call.nonce });
  assert.deepEqual(outcome, { ok: true });
  const attested = JSON.parse(meta!.inputAttestations![0].data) as { price: number };
  assert.equal(result.content[0].text, String((("AAPL".split("").reduce((t, c) => t + c.charCodeAt(0), 0) % 100) + attested.price) % 100));
}));

run("tampered data yields provenanceInvalid", async () => withServerOptions({ tlsnSidecarUrl: SIDECAR }, async (server) => {
  const client = new VerifiableClient(server.mcpUrl, { allowedKeyOrigins: [new URL(SIDECAR!).origin] });
  await client.discover();
  client.addProvenanceVerifier(VERIFIER());
  client.setCapabilities({ proofFormats: ["demo-commit-v1"], requireInputProvenance: true });
  const call = await client.callTool("riskScore", { symbol: "AAPL" }, { proofFormat: "demo-commit-v1" });
  const result = expectComplete(call.result);
  const meta = structuredClone(result._meta![EXTENSION_ID] as VerifiableToolsMeta);
  meta.inputAttestations![0].data = '{"currency":"USD","price":1,"symbol":"AAPL"}';
  result._meta![EXTENSION_ID] = meta as never;
  const outcome = await client.verify(result, { symbol: "AAPL" }, "riskScore", { nonce: call.nonce });
  assert.deepEqual(outcome, { ok: false, reason: "provenanceInvalid" });
  // The same tampering is rejected by the sidecar's own /verify.
  const pem = await fetch(meta.inputAttestations![0].notaryKeyUri!).then((r) => r.text());
  const sidecarOutcome = await tlsnVerify(meta.inputAttestations![0], pem);
  assert.equal(sidecarOutcome.ok, false);
}));

run("a different notary key fails sidecar /verify", async () => {
  const attest = await fetch(`${SIDECAR}/attest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source: "https://test-server.io/v1/price/AAPL" })
  });
  const attestation = await attest.json();
  const other = generateSecp256k1("ec", { namedCurve: "secp256k1" });
  const pem = String(other.publicKey.export({ type: "spki", format: "pem" }));
  const outcome = await tlsnVerify(attestation, pem);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.reason, "notaryKeyMismatch");
});

run("/attest rejects non-fixture sources", async () => {
  const response = await fetch(`${SIDECAR}/attest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source: "https://evil.example/v1/price/AAPL" })
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "invalidSource" });
});
