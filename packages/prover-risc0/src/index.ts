// risc0-v1: proof = a RISC Zero composite receipt (bincode) verified in-process
// by a wasm32 build of risc0-zkvm (sidecars/risc0/wasm-verify). The guest
// computes sum = a + b on u32 and commits a 12-byte LE journal a||b||sum.
// Binding follows the snarkjs-v2 / noir-v1 pattern: inputCommitment /
// outputCommitment / nonce are checked by verifyResult and echoed in
// publicInputs[0..3]; the circuit's public inputs are [sum, a, b].
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { VerifiableToolsMeta, parseAddArguments } from "@demo/protocol";
import { Verifier, VerifyContext } from "@demo/verifier";
import { SidecarVerifier } from "@demo/prover-sidecar";

export const FORMAT = "risc0-v1";

export function imageIdFromCircuitHash(circuitHash: string): Uint8Array {
  const hex = circuitHash.startsWith("0x") ? circuitHash.slice(2) : circuitHash;
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error("invalid risc0-v1 circuitHash (expected 32-byte hex image id)");
  return Uint8Array.from(Buffer.from(hex, "hex"));
}

interface Risc0VerifyExports {
  memory: WebAssembly.Memory;
  wasm_alloc: (len: number) => number;
  wasm_free: (ptr: number, len: number) => void;
  verify_receipt: (receiptPtr: number, receiptLen: number, idPtr: number) => number;
  journal_ptr: () => number;
  journal_len: () => number;
}

let wasmInstance: Promise<Risc0VerifyExports> | undefined;
function loadVerifier(): Promise<Risc0VerifyExports> {
  wasmInstance ??= (async () => {
    const bytes = await readFile(fileURLToPath(new URL("../../wasm/risc0_verify.wasm", import.meta.url)));
    const { instance } = await WebAssembly.instantiate(bytes, {});
    return instance.exports as unknown as Risc0VerifyExports;
  })();
  return wasmInstance;
}

// Runs the wasm verifier; returns the verified journal or undefined.
async function verifyReceiptWasm(proof: Uint8Array, imageId: Uint8Array): Promise<Uint8Array | undefined> {
  const wasm = await loadVerifier();
  const receiptPtr = wasm.wasm_alloc(proof.length);
  const idPtr = wasm.wasm_alloc(32);
  try {
    new Uint8Array(wasm.memory.buffer, receiptPtr, proof.length).set(proof);
    new Uint8Array(wasm.memory.buffer, idPtr, 32).set(imageId);
    const result = wasm.verify_receipt(receiptPtr, proof.length, idPtr);
    if (result !== 1) return undefined;
    return new Uint8Array(wasm.memory.buffer, wasm.journal_ptr(), wasm.journal_len()).slice();
  } finally {
    wasm.wasm_free(receiptPtr, proof.length);
    wasm.wasm_free(idPtr, 32);
  }
}

export async function verifyRisc0(meta: VerifiableToolsMeta, context: VerifyContext): Promise<boolean> {
  if (meta.proofFormat !== FORMAT || meta.circuitHash !== context.expectedCircuitHash || !meta.proof) return false;
  let imageId: Uint8Array;
  try { imageId = imageIdFromCircuitHash(context.expectedCircuitHash); } catch { return false; }
  let journal: Uint8Array | undefined;
  try {
    journal = await verifyReceiptWasm(Uint8Array.from(Buffer.from(meta.proof, "base64url")), imageId);
  } catch { return false; }
  if (!journal || journal.length !== 12) return false;
  const view = new DataView(journal.buffer, journal.byteOffset, journal.byteLength);
  const a = view.getUint32(0, true), b = view.getUint32(4, true), sum = view.getUint32(8, true);
  const args = parseAddArguments(context.arguments);
  if (!args || args.a !== a || args.b !== b) return false;
  if (context.content[0]?.text !== String(sum)) return false;
  const tail = Array.isArray(meta.publicInputs) ? meta.publicInputs.slice(3) : [];
  return JSON.stringify(tail) === JSON.stringify([String(sum), String(a), String(b)]);
}

export class Risc0Verifier implements Verifier {
  readonly format = FORMAT;
  async verify(meta: VerifiableToolsMeta, context: VerifyContext, options: { signal?: AbortSignal } = {}): Promise<boolean> {
    try { return await verifyRisc0(meta, context); } catch (error) {
      if (options.signal?.aborted) throw error;
      return false;
    }
  }
}

export const verifier: Verifier = new Risc0Verifier();
export const sidecarVerifier = (baseUrl: string): Verifier => new SidecarVerifier({ baseUrl, format: FORMAT });
