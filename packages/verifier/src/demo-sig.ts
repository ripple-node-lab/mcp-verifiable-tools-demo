import { verify as verifySignature } from "node:crypto";
import { VerifiableToolsMeta } from "@demo/protocol";
import { VerificationKeyRegistry } from "./registry.js";
import { Verifier, VerifyContext } from "./verifier.js";
export class DemoSigVerifier implements Verifier {
  readonly format = "demo-sig-v1";
  constructor(private readonly registry: VerificationKeyRegistry = new VerificationKeyRegistry([])) {}
  async verify(meta: VerifiableToolsMeta, context: VerifyContext): Promise<boolean> {
    const verificationKeyUri = context.verificationKeyUri ?? meta.verificationKeyUri;
    if (meta.proofFormat !== this.format || !verificationKeyUri || !meta.proof || !meta.circuitHash || !meta.outputCommitment) return false;
    const key = await this.registry.get(meta.circuitHash, verificationKeyUri);
    const signature = Buffer.from(meta.proof.slice(2), "hex");
    return verifySignature(null, Buffer.from(meta.circuitHash + meta.inputCommitment + meta.outputCommitment + (meta.nonce ?? "0x")), key as Parameters<typeof verifySignature>[2], signature) &&
      Array.isArray(meta.publicInputs) && meta.publicInputs.length === 3 &&
      meta.publicInputs[0] === meta.outputCommitment && meta.publicInputs[1] === meta.inputCommitment && meta.publicInputs[2] === (meta.nonce ?? "0x");
  }
}
