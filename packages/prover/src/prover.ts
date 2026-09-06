import { JsonValue, VerifiableToolsMeta } from "@demo/protocol";
import { createHash } from "node:crypto";
export interface ProveInput {
  circuitHash: string;
  inputCommitment: string;
  outputCommitment: string;
  nonce?: string;
  output: string;
  verificationKeyUri?: string;
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
