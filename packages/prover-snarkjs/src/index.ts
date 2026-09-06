import { JsonValue, VerifiableToolsMeta, jcs, parseAddArguments, publicInputs } from "@demo/protocol";
import { Prover, ProveInput } from "@demo/prover";
import { FORMAT, circuitHash } from "./constants.js";
import { groth16Promise } from "./runtime.js";

export { FORMAT, circuitHash } from "./constants.js";
export const artifacts = {
  wasm: new URL("../../circuits/add/add.wasm", import.meta.url),
  zkey: new URL("../../circuits/add/add_final.zkey", import.meta.url),
  vk: new URL("../../circuits/add/vk.json", import.meta.url)
};

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("aborted", "AbortError");
}

export class SnarkjsProver implements Prover {
  readonly format = FORMAT;
  async prove(input: ProveInput, options: { signal?: AbortSignal } = {}): Promise<VerifiableToolsMeta> {
    checkAbort(options.signal);
    const args = parseAddArguments(input.arguments);
    if (!args) throw new Error("arguments out of circuit range");
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
