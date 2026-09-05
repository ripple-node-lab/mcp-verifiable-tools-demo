import { createHash, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { Prover, ProveInput } from "./prover.js";
import { VerifiableToolsMeta } from "@demo/protocol";
export class DemoSigProver implements Prover {
  readonly format = "demo-sig-v1";
  readonly publicKey: ReturnType<typeof createPublicKey>;
  private readonly privateKey: Parameters<typeof sign>[2];
  constructor() {
    const pair = generateKeyPairSync("ed25519");
    this.privateKey = pair.privateKey;
    this.publicKey = pair.publicKey;
  }
  prove(input: ProveInput): VerifiableToolsMeta {
    const outputHash = createHash("sha256").update(input.output).digest("hex");
    const proof = sign(null, Buffer.from(input.circuitHash + input.inputCommitment + outputHash), this.privateKey);
    return { proof: `0x${proof.toString("hex")}`, proofFormat: this.format, circuitHash: input.circuitHash, inputCommitment: input.inputCommitment, ...(input.verificationKeyUri ? { verificationKeyUri: input.verificationKeyUri } : {}) };
  }
}
