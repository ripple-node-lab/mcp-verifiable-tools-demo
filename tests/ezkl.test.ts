import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { CallToolResult, VerifiableToolsMeta, expectedCircuitHash } from "@demo/protocol";
import { verifyResult, VerifyContext } from "@demo/verifier";
import { EzklVerifier } from "@demo/prover-ezkl";

const FIXTURES = new URL("../../sidecars/ezkl/fixtures/", import.meta.url);
const EZKL_HASH = expectedCircuitHash("add", "ezkl-v1");
const ARGS = { a: 2, b: 40 };
const NONCE = "0x11223344556677889900aabbccddee11";
const CONTENT: CallToolResult["content"] = [{ type: "text", text: "42" }];

async function fixtureMeta(): Promise<VerifiableToolsMeta> {
  const meta = JSON.parse(await readFile(fileURLToPath(new URL("add-proof.meta.json", FIXTURES)), "utf8")) as VerifiableToolsMeta;
  const proof = await readFile(fileURLToPath(new URL("add-proof.json", FIXTURES)));
  meta.proof = Buffer.from(proof).toString("base64url");
  return meta;
}

function context(content: CallToolResult["content"] = CONTENT): VerifyContext {
  return { arguments: ARGS, content, nonce: NONCE, expectedCircuitHash: EZKL_HASH };
}

test("ezkl-v1 in-process WASM verifier accepts a real proof", async () => {
  const meta = await fixtureMeta();
  const outcome = await verifyResult(meta, context(), [new EzklVerifier()]);
  assert.deepEqual(outcome, { ok: true });
});

test("ezkl-v1 rejects a wrong expectedCircuitHash", async () => {
  const meta = await fixtureMeta();
  const outcome = await verifyResult(meta, { ...context(), expectedCircuitHash: expectedCircuitHash("add") }, [new EzklVerifier()]);
  assert.deepEqual(outcome, { ok: false, reason: "circuitHashMismatch" });
});

test("ezkl-v1 rejects a tampered proof blob", async () => {
  const meta = await fixtureMeta();
  const bytes = Buffer.from(meta.proof!, "base64url");
  bytes[bytes.length - 1] ^= 0xff;
  meta.proof = bytes.toString("base64url");
  const outcome = await verifyResult(meta, context(), [new EzklVerifier()]);
  assert.equal(outcome.ok, false);
});

test("ezkl-v1 rejects a tampered public instance", async () => {
  const meta = await fixtureMeta();
  const proof = JSON.parse(Buffer.from(meta.proof!, "base64url").toString("utf8"));
  proof.instances[0][2] = "2b00000000000000000000000000000000000000000000000000000000000000";
  meta.proof = Buffer.from(JSON.stringify(proof), "utf8").toString("base64url");
  const outcome = await verifyResult(meta, context(), [new EzklVerifier()]);
  assert.deepEqual(outcome, { ok: false, reason: "proofInvalid" });
});

test("ezkl-v1 rejects wrong content text", async () => {
  const meta = await fixtureMeta();
  const outcome = await verifyResult(meta, context([{ type: "text", text: "43" }]), [new EzklVerifier()]);
  assert.deepEqual(outcome, { ok: false, reason: "outputCommitmentMismatch" });
});

for (const [label, index] of [["outputCommitment entry", 0], ["inputCommitment entry", 1], ["nonce entry", 2]] as const) {
  test(`ezkl-v1 rejects an altered ${label}`, async () => {
    const meta = await fixtureMeta();
    meta.publicInputs![index] = "0xdeadbeef";
    const outcome = await verifyResult(meta, context(), [new EzklVerifier()]);
    assert.deepEqual(outcome, { ok: false, reason: "proofInvalid" });
  });
}

for (const [label, entries] of [
  ["5-entry", ["0x5f0cd6507175ef4a9450721e54fa2e534fe911bff7f37afdbba0c41ebe1f9458", "0xcbeb5e9673b2ac12665726b4bbc07a00bd3619838f961292227696fbe343440f", "0x11223344556677889900aabbccddee11", "42", "2"]],
  ["7-entry", ["0x5f0cd6507175ef4a9450721e54fa2e534fe911bff7f37afdbba0c41ebe1f9458", "0xcbeb5e9673b2ac12665726b4bbc07a00bd3619838f961292227696fbe343440f", "0x11223344556677889900aabbccddee11", "42", "2", "40", "extra"]]
] as const) {
  test(`ezkl-v1 rejects ${label} publicInputs`, async () => {
    const meta = await fixtureMeta();
    meta.publicInputs = entries as unknown as string[];
    const outcome = await verifyResult(meta, context(), [new EzklVerifier()]);
    assert.deepEqual(outcome, { ok: false, reason: "proofInvalid" });
  });
}

test("ezkl-v1 rejects a numeric publicInputs entry", async () => {
  const meta = await fixtureMeta();
  meta.publicInputs![3] = 42 as unknown as string;
  const outcome = await verifyResult(meta, context(), [new EzklVerifier()]);
  assert.deepEqual(outcome, { ok: false, reason: "proofInvalid" });
});

test("ezkl-v1 verify rejects with AbortError on a pre-aborted signal", async () => {
  const meta = await fixtureMeta();
  const verifier = new EzklVerifier();
  const ctx = context();
  const signal = AbortSignal.abort();
  const error = await verifier.verify(meta, ctx, { signal }).catch((e: unknown) => e);
  assert.equal((error as Error).name, "AbortError");
});
