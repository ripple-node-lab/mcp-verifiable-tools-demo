import { InputAttestation, JsonValue, VerifiableToolsMeta } from "@demo/protocol";
import { createHash } from "node:crypto";
export interface ProveInput {
  arguments: JsonValue;
  circuitHash: string;
  inputCommitment: string;
  outputCommitment: string;
  nonce?: string;
  output: string;
  verificationKeyUri?: string;
  inputAttestations?: InputAttestation[];
}
// Attestation commitments appended to publicInputs and covered by the proof.
export function attestationCommits(input: ProveInput): string[] {
  return (input.inputAttestations ?? []).map((attestation) => attestation.commitment);
}
export interface Prover {
  readonly format: string;
  prove(input: ProveInput, options?: { signal?: AbortSignal }): Promise<VerifiableToolsMeta>;
}
export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
export { jcs as canonicalJson } from "@demo/protocol";
export type { JsonValue, VerifiableToolsMeta };
