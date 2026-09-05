import { Prover, ProveInput, sha256 } from "./prover.js";
import { VerifiableToolsMeta } from "@demo/protocol";
export class DemoCommitProver implements Prover {
  readonly format = "demo-commit-v1";
  prove(input: ProveInput): VerifiableToolsMeta {
    const publicInputs = [input.output, input.inputCommitment];
    return { proof: `0x${sha256(input.circuitHash + JSON.stringify(publicInputs))}`, proofFormat: this.format, circuitHash: input.circuitHash, inputCommitment: input.inputCommitment, publicInputs };
  }
}
