import { CallToolResult, JsonValue, VerifiableToolsMeta, inputCommitment, outputCommitment } from "@demo/protocol";
import { ProvenanceVerifier, verifyProvenance } from "./provenance.js";
export interface VerifyContext {
  arguments: JsonValue;
  content: CallToolResult["content"];
  nonce?: string;
  salt?: Uint8Array;
  expectedCircuitHash: string;
  verificationKeyUri?: string;
  registry?: VerificationKeyRegistryLike;
}
export interface VerificationKeyRegistryLike {
  get(circuitHash: string, uri: string): Promise<unknown>;
  getBytes?(circuitHash: string, uri: string): Promise<Uint8Array>;
}
export interface Verifier {
  readonly format: string;
  verify(meta: VerifiableToolsMeta, context: VerifyContext, options?: { signal?: AbortSignal }): Promise<boolean>;
}
export type VerifyOutcome =
  | { ok: true }
  | { ok: false; reason: "noProof" | "formatNotNegotiated" | "circuitHashMismatch" | "missingCommitment" | "inputCommitmentMismatch" | "outputCommitmentMismatch" | "nonceMismatch" | "proofInvalid" | "provenanceMissing" | "provenanceMalformed" | "provenanceUnbound" | "provenanceUnsupported" | "provenanceInvalid" };

export interface ProvenanceVerificationOptions {
  required: boolean;
  verifiers: ProvenanceVerifier[];
  registry?: VerificationKeyRegistryLike;
  signal?: AbortSignal;
}

export async function verifyResult(meta: VerifiableToolsMeta | undefined, context: VerifyContext, verifiers: Verifier[], provenance?: ProvenanceVerificationOptions): Promise<VerifyOutcome> {
  if (!meta?.proof || !meta.proofFormat) return { ok: false, reason: "noProof" };
  const verifier = verifiers.find((candidate) => candidate.format === meta.proofFormat);
  if (!verifier) return { ok: false, reason: "formatNotNegotiated" };
  if (meta.circuitHash !== context.expectedCircuitHash) return { ok: false, reason: "circuitHashMismatch" };
  if (!meta.inputCommitment || !meta.outputCommitment) return { ok: false, reason: "missingCommitment" };
  if (meta.inputCommitment !== inputCommitment(context.arguments, context.salt)) return { ok: false, reason: "inputCommitmentMismatch" };
  if (meta.outputCommitment !== outputCommitment(context.content)) return { ok: false, reason: "outputCommitmentMismatch" };
  if (context.nonce !== undefined ? meta.nonce !== context.nonce : meta.nonce !== undefined) return { ok: false, reason: "nonceMismatch" };
  if (!(await verifier.verify(meta, context))) return { ok: false, reason: "proofInvalid" };
  // Provenance runs whenever a policy is supplied, or when the meta carries
  // attestations at all — attached attestations must always be valid.
  if (provenance || meta.inputAttestations !== undefined) {
    const outcome = await verifyProvenance(meta, {
      required: provenance?.required ?? false,
      verifiers: provenance?.verifiers ?? [],
      registry: provenance?.registry ?? context.registry,
      signal: provenance?.signal
    });
    if (!outcome.ok) return outcome;
  }
  return { ok: true };
}
export function assertVerifiable(meta: VerifiableToolsMeta | undefined): asserts meta is VerifiableToolsMeta {
  if (!meta?.proof || !meta.proofFormat || !meta.circuitHash) throw new Error("missing verifiable proof metadata");
}
