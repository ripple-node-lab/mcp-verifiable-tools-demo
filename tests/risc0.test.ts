import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { CallToolResult, VerifiableToolsMeta, expectedCircuitHash } from "@demo/protocol";
import { verifyResult, VerifyContext } from "@demo/verifier";
import { Risc0Verifier } from "@demo/prover-risc0";

const FIXTURES = new URL("../../sidecars/risc0/fixtures/", import.meta.url);
const RISC0_HASH = expectedCircuitHash("add", "risc0-v1");
const ARGS = { a: 2, b: 40 };
const NONCE = "0x11223344556677889900aabbccddee11";
const CONTENT: CallToolResult["content"] = [{ type: "text", text: "42" }];

async function fixtureMeta(dev = false): Promise<VerifiableToolsMeta> {
  const base = dev ? "add-receipt-dev" : "add-receipt";
  const meta = JSON.parse(await readFile(fileURLToPath(new URL(`${base}.json`, FIXTURES)), "utf8")) as VerifiableToolsMeta;
  meta.proof = (await readFile(fileURLToPath(new URL(`${base}.b64`, FIXTURES)), "utf8")).trim();
  return meta;
}

function context(content: CallToolResult["content"] = CONTENT): VerifyContext {
  return { arguments: ARGS, content, nonce: NONCE, expectedCircuitHash: RISC0_HASH };
}

test("risc0-v1 in-process WASM verifier accepts a real composite receipt", async () => {
  const meta = await fixtureMeta();
  const outcome = await verifyResult(meta, context(), [new Risc0Verifier()]);
  assert.deepEqual(outcome, { ok: true });
});

test("risc0-v1 rejects a wrong expectedCircuitHash", async () => {
  const meta = await fixtureMeta();
  const outcome = await verifyResult(meta, { ...context(), expectedCircuitHash: expectedCircuitHash("add") }, [new Risc0Verifier()]);
  assert.deepEqual(outcome, { ok: false, reason: "circuitHashMismatch" });
});

test("risc0-v1 rejects a tampered receipt", async () => {
  const meta = await fixtureMeta();
  const bytes = Buffer.from(meta.proof!, "base64url");
  bytes[bytes.length - 1] ^= 0xff;
  meta.proof = bytes.toString("base64url");
  const outcome = await verifyResult(meta, context(), [new Risc0Verifier()]);
  assert.deepEqual(outcome, { ok: false, reason: "proofInvalid" });
});

test("risc0-v1 rejects a publicInputs tail mismatch", async () => {
  const meta = await fixtureMeta();
  meta.publicInputs![3] = "43";
  const outcome = await verifyResult(meta, context(), [new Risc0Verifier()]);
  assert.deepEqual(outcome, { ok: false, reason: "proofInvalid" });
});

for (const [label, index] of [["outputCommitment entry", 0], ["inputCommitment entry", 1], ["nonce entry", 2]] as const) {
  test(`risc0-v1 rejects an altered ${label}`, async () => {
    const meta = await fixtureMeta();
    meta.publicInputs![index] = "0xdeadbeef";
    const outcome = await verifyResult(meta, context(), [new Risc0Verifier()]);
    assert.deepEqual(outcome, { ok: false, reason: "proofInvalid" });
  });
}

for (const [label, length] of [["short", 5], ["long", 7]] as const) {
  test(`risc0-v1 rejects a ${label} publicInputs array`, async () => {
    const meta = await fixtureMeta();
    meta.publicInputs = length === 5 ? meta.publicInputs!.slice(0, 5) : [...meta.publicInputs!, "extra"];
    const outcome = await verifyResult(meta, context(), [new Risc0Verifier()]);
    assert.deepEqual(outcome, { ok: false, reason: "proofInvalid" });
  });
}

test("risc0-v1 rejects a numeric entry in the publicInputs tail", async () => {
  const meta = await fixtureMeta();
  meta.publicInputs![5] = 40;
  const outcome = await verifyResult(meta, context(), [new Risc0Verifier()]);
  assert.deepEqual(outcome, { ok: false, reason: "proofInvalid" });
});

test("risc0-v1 rejects changed content", async () => {
  const meta = await fixtureMeta();
  const outcome = await verifyResult(meta, context([{ type: "text", text: "43" }]), [new Risc0Verifier()]);
  assert.deepEqual(outcome, { ok: false, reason: "outputCommitmentMismatch" });
});

test("risc0-v1 rejects a dev-mode fake receipt", async () => {
  const meta = await fixtureMeta(true);
  const outcome = await verifyResult(meta, context(), [new Risc0Verifier()]);
  assert.deepEqual(outcome, { ok: false, reason: "proofInvalid" });
});

test("risc0-v1 verifier rejects with AbortError on a pre-aborted signal", async () => {
  const meta = await fixtureMeta();
  await assert.rejects(() => new Risc0Verifier().verify(meta, context(), { signal: AbortSignal.abort() }));
  const error = await new Risc0Verifier().verify(meta, context(), { signal: AbortSignal.abort() }).catch((e: unknown) => e);
  assert.equal((error as DOMException).name, "AbortError");
});
