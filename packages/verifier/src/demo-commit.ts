import { VerifiableToolsMeta } from "@demo/protocol";
import { sha256 } from "@demo/prover";
import { Verifier, VerifyContext } from "./verifier.js";
export class DemoCommitVerifier implements Verifier {
  readonly format = "demo-commit-v1";
  async verify(meta: VerifiableToolsMeta, context: VerifyContext): Promise<boolean> {
    if (meta.proofFormat !== this.format || !meta.proof || !meta.circuitHash || !meta.outputCommitment) return false;
    const publicInputs = [meta.outputCommitment, meta.inputCommitment, meta.nonce ?? "0x", context.content[0]?.text];
    return meta.publicInputs?.length === 4 &&
      meta.publicInputs[0] === publicInputs[0] &&
      meta.publicInputs[1] === publicInputs[1] &&
      meta.publicInputs[2] === publicInputs[2] &&
      meta.publicInputs[3] === publicInputs[3] &&
      meta.proof === `0x${sha256(meta.circuitHash + JSON.stringify(publicInputs))}`;
  }
}
