import { createHash, verify as verifySignature } from "node:crypto";
import { VerifiableToolsMeta } from "@demo/protocol";
import { expectedInputCommitment } from "./verifier.js";
import { VerificationKeyRegistry } from "./registry.js";
import { Verifier, VerifyContext } from "./verifier.js";
export class DemoSigVerifier implements Verifier {
  readonly format = "demo-sig-v1";
  constructor(private readonly registry: VerificationKeyRegistry = new VerificationKeyRegistry([])) {}
  async verify(meta: VerifiableToolsMeta, context: VerifyContext): Promise<boolean> {
    if (meta.proofFormat !== this.format || !meta.verificationKeyUri || meta.inputCommitment !== expectedInputCommitment(context.arguments)) return false;
    if (meta.inputCommitment === undefined || !meta.proof || !meta.circuitHash) return false;
    const key = await this.registry.get(meta.circuitHash, meta.verificationKeyUri);
    const outputHash = createHash("sha256").update(context.output).digest("hex");
    const signature = Buffer.from(meta.proof.slice(2), "hex");
    return verifySignature(null, Buffer.from(meta.circuitHash + meta.inputCommitment + outputHash), key as Parameters<typeof verifySignature>[2], signature);
  }
}
