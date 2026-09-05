import { JsonValue, VerifiableToolsMeta } from "@demo/protocol";
export interface VerifyContext {
  arguments: JsonValue;
  output: string;
  registry?: VerificationKeyRegistryLike;
}
export interface VerificationKeyRegistryLike { get(circuitHash: string, uri: string): Promise<unknown>; }
export interface Verifier {
  readonly format: string;
  verify(meta: VerifiableToolsMeta, context: VerifyContext): Promise<boolean>;
}
export function assertVerifiable(meta: VerifiableToolsMeta | undefined): asserts meta is VerifiableToolsMeta {
  if (!meta?.proof || !meta.proofFormat || !meta.circuitHash) throw new Error("missing verifiable proof metadata");
}
import { canonicalJson, sha256 } from "@demo/prover";
export function expectedInputCommitment(args: JsonValue): string {
  return `0x${sha256(canonicalJson(args))}`;
}
