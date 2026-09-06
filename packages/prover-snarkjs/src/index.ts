import { JsonValue, VerifiableToolsMeta, jcs, publicInputs } from "@demo/protocol";
import { Prover, ProveInput } from "@demo/prover";
import { FORMAT, circuitHash } from "./constants.js";
import { groth16Promise } from "./runtime.js";

export { FORMAT, circuitHash } from "./constants.js";
export const artifacts = {
  wasm: new URL("../../circuits/add/add.wasm", import.meta.url),
  zkey: new URL("../../circuits/add/add_final.zkey", import.meta.url),
  vk: new URL("../../circuits/add/vk.json", import.meta.url)
};

function inputs(value: JsonValue): { a: number; b: number } {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      typeof value.a !== "number" || !Number.isInteger(value.a) || value.a < 0 || value.a > 0xffffffff ||
      typeof value.b !== "number" || !Number.isInteger(value.b) || value.b < 0 || value.b > 0xffffffff) {
    throw new Error("arguments out of circuit range");
  }
  return { a: value.a, b: value.b };
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("aborted", "AbortError");
}

export class SnarkjsProver implements Prover {
  readonly format = FORMAT;
  async prove(input: ProveInput, options: { signal?: AbortSignal } = {}): Promise<VerifiableToolsMeta> {
    checkAbort(options.signal);
    const args = inputs(input.arguments);
    const groth16 = await groth16Promise;
    const result = await groth16.fullProve(args, artifacts.wasm.pathname, artifacts.zkey.pathname, undefined, undefined, { singleThread: true });
    checkAbort(options.signal);
    return {
      proof: Buffer.from(jcs(result.proof)).toString("base64url"),
      proofFormat: FORMAT,
      circuitHash,
      inputCommitment: input.inputCommitment,
      outputCommitment: input.outputCommitment,
      ...(input.nonce === undefined ? {} : { nonce: input.nonce }),
      verificationKeyUri: input.verificationKeyUri,
      publicInputs: publicInputs(input.outputCommitment, input.inputCommitment, input.nonce, result.publicSignals)
    };
  }
}

export const prover: Prover = new SnarkjsProver();
export { SnarkjsVerifier, verifier } from "./verifier.js";
export { verifySnarkjs } from "./verifier.js";
