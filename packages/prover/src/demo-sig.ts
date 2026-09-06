import { createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { Prover, ProveInput, attestationCommits } from "./prover.js";
import { VerifiableToolsMeta } from "@demo/protocol";
export class DemoSigProver implements Prover {
  readonly publicKey: ReturnType<typeof createPublicKey>;
  private readonly privateKey: Parameters<typeof sign>[2];
  constructor(readonly format = "demo-sig-v1") {
    const pair = generateKeyPairSync("ed25519");
    this.privateKey = pair.privateKey;
    this.publicKey = pair.publicKey;
  }
  async prove(input: ProveInput, options: { signal?: AbortSignal } = {}): Promise<VerifiableToolsMeta> {
    if (options.signal?.aborted) throw new DOMException("aborted", "AbortError");
    const commits = attestationCommits(input);
    const proof = sign(null, Buffer.from(input.circuitHash + input.inputCommitment + input.outputCommitment + (input.nonce ?? "0x") + commits.join("")), this.privateKey);
    return {
      proof: `0x${proof.toString("hex")}`,
      proofFormat: this.format,
      circuitHash: input.circuitHash,
      inputCommitment: input.inputCommitment,
      outputCommitment: input.outputCommitment,
      ...(input.nonce === undefined ? {} : { nonce: input.nonce }),
      ...(input.verificationKeyUri ? { verificationKeyUri: input.verificationKeyUri } : {}),
      publicInputs: [input.outputCommitment, input.inputCommitment, input.nonce ?? "0x", ...commits],
      ...(commits.length === 0 ? {} : { inputAttestations: input.inputAttestations })
    };
  }
}
