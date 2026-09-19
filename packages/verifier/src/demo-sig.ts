import { verify as verifySignature } from "node:crypto";
import { VerifiableToolsMeta } from "@demo/protocol";
import { VerificationKeyRegistry } from "./registry.js";
import { Verifier, VerifyContext } from "./verifier.js";
export class DemoSigVerifier implements Verifier {
  constructor(private readonly registry: VerificationKeyRegistry = new VerificationKeyRegistry([]), readonly format = "demo-sig-v1") {}
  async verify(meta: VerifiableToolsMeta, context: VerifyContext): Promise<boolean> {
    const verificationKeyUri = context.verificationKeyUri ?? meta.verificationKeyUri;
    if (meta.proofFormat !== this.format || !verificationKeyUri || typeof meta.proof !== "string" || !meta.circuitHash || !meta.outputCommitment) return false;
    let key: Awaited<ReturnType<VerificationKeyRegistry["get"]>>;
    try {
      key = await this.registry.get(meta.circuitHash, verificationKeyUri);
    } catch {
      return false;
    }
    const signature = Buffer.from(meta.proof.slice(2), "hex");
    const commits = (meta.inputAttestations ?? []).map((attestation) => attestation?.commitment);
    let signatureValid: boolean;
    try {
      signatureValid = verifySignature(null, Buffer.from(meta.circuitHash + meta.inputCommitment + meta.outputCommitment + (meta.nonce ?? "0x") + commits.join("")), key as Parameters<typeof verifySignature>[2], signature);
    } catch {
      return false;
    }
    return signatureValid &&
      Array.isArray(meta.publicInputs) && meta.publicInputs.length === 3 + commits.length &&
      meta.publicInputs[0] === meta.outputCommitment && meta.publicInputs[1] === meta.inputCommitment && meta.publicInputs[2] === (meta.nonce ?? "0x") &&
      meta.publicInputs.slice(3).every((entry, i) => entry === commits[i]);
  }
}
