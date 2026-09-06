import { CallToolResult, JsonValue, VerifiableToolsMeta, inputCommitment, outputCommitment } from "@demo/protocol";
export interface VerifyContext {
  arguments: JsonValue;
  content: CallToolResult["content"];
  nonce?: string;
  salt?: Uint8Array;
  expectedCircuitHash: string;
  registry?: VerificationKeyRegistryLike;
}
export interface VerificationKeyRegistryLike { get(circuitHash: string, uri: string): Promise<unknown>; }
export interface Verifier {
  readonly format: string;
  verify(meta: VerifiableToolsMeta, context: VerifyContext): Promise<boolean>;
}
export type VerifyOutcome =
  | { ok: true }
  | { ok: false; reason: "noProof" | "formatNotNegotiated" | "circuitHashMismatch" | "missingCommitment" | "inputCommitmentMismatch" | "outputCommitmentMismatch" | "nonceMismatch" | "proofInvalid" };

export async function verifyResult(meta: VerifiableToolsMeta | undefined, context: VerifyContext, verifiers: Verifier[]): Promise<VerifyOutcome> {
  if (!meta?.proof || !meta.proofFormat) return { ok: false, reason: "noProof" };
  const verifier = verifiers.find((candidate) => candidate.format === meta.proofFormat);
  if (!verifier) return { ok: false, reason: "formatNotNegotiated" };
  if (meta.circuitHash !== context.expectedCircuitHash) return { ok: false, reason: "circuitHashMismatch" };
  if (!meta.inputCommitment || !meta.outputCommitment) return { ok: false, reason: "missingCommitment" };
  if (meta.inputCommitment !== inputCommitment(context.arguments, context.salt)) return { ok: false, reason: "inputCommitmentMismatch" };
  if (meta.outputCommitment !== outputCommitment(context.content)) return { ok: false, reason: "outputCommitmentMismatch" };
  if (context.nonce !== undefined ? meta.nonce !== context.nonce : meta.nonce !== undefined) return { ok: false, reason: "nonceMismatch" };
  return await verifier.verify(meta, context) ? { ok: true } : { ok: false, reason: "proofInvalid" };
}
export function assertVerifiable(meta: VerifiableToolsMeta | undefined): asserts meta is VerifiableToolsMeta {
  if (!meta?.proof || !meta.proofFormat || !meta.circuitHash) throw new Error("missing verifiable proof metadata");
}
