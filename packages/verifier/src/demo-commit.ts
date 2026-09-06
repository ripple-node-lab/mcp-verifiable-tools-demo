import { VerifiableToolsMeta } from "@demo/protocol";
import { sha256 } from "@demo/prover";
import { Verifier, VerifyContext } from "./verifier.js";
export class DemoCommitVerifier implements Verifier {
  readonly format = "demo-commit-v1";
  async verify(meta: VerifiableToolsMeta, context: VerifyContext): Promise<boolean> {
    if (meta.proofFormat !== this.format || !meta.proof || !meta.circuitHash || !meta.outputCommitment) return false;
    const commits = (meta.inputAttestations ?? []).map((attestation) => attestation?.commitment);
    const publicInputs = [meta.outputCommitment, meta.inputCommitment, meta.nonce ?? "0x", context.content[0]?.text, ...commits];
    return meta.publicInputs?.length === publicInputs.length &&
      meta.publicInputs.every((entry, i) => entry === publicInputs[i]) &&
      meta.proof === `0x${sha256(meta.circuitHash + JSON.stringify(publicInputs))}`;
  }
}
