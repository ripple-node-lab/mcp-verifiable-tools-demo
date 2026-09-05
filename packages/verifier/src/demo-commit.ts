import { VerifiableToolsMeta } from "@demo/protocol";
import { sha256 } from "@demo/prover";
import { expectedInputCommitment, Verifier, VerifyContext } from "./verifier.js";
export class DemoCommitVerifier implements Verifier {
  readonly format = "demo-commit-v1";
  async verify(meta: VerifiableToolsMeta, context: VerifyContext): Promise<boolean> {
    if (meta.proofFormat !== this.format || !meta.proof || !meta.circuitHash || meta.inputCommitment !== expectedInputCommitment(context.arguments)) return false;
    const publicInputs = [context.output, meta.inputCommitment];
    return meta.publicInputs?.length === 2 &&
      meta.publicInputs[0] === publicInputs[0] &&
      meta.publicInputs[1] === publicInputs[1] &&
      meta.proof === `0x${sha256(meta.circuitHash + JSON.stringify(publicInputs))}`;
  }
}
