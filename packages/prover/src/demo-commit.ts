import { Prover, ProveInput, sha256 } from "./prover.js";
import { VerifiableToolsMeta } from "@demo/protocol";
export class DemoCommitProver implements Prover {
  readonly format = "demo-commit-v1";
  async prove(input: ProveInput, options: { signal?: AbortSignal } = {}): Promise<VerifiableToolsMeta> {
    if (options.signal?.aborted) throw new DOMException("aborted", "AbortError");
    const publicInputs = [input.outputCommitment, input.inputCommitment, input.nonce ?? "0x", input.output];
    return {
      proof: `0x${sha256(input.circuitHash + JSON.stringify(publicInputs))}`,
      proofFormat: this.format,
      circuitHash: input.circuitHash,
      inputCommitment: input.inputCommitment,
      outputCommitment: input.outputCommitment,
      ...(input.nonce === undefined ? {} : { nonce: input.nonce }),
      publicInputs
    };
  }
}
