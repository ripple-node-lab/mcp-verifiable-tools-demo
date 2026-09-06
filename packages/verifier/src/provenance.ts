// Input provenance: inputAttestations attached to a proof meta. Each
// attestation's commitment must appear in meta.publicInputs (bound into the
// proof) and equal sha256(utf8(data)); the artifact itself is verified by a
// per-type ProvenanceVerifier.
import { verify as verifySignature } from "node:crypto";
import { InputAttestation, JsonValue, VerifiableToolsMeta, attestationCommitment, jcs, parseInputAttestation } from "@demo/protocol";
import type { VerificationKeyRegistryLike } from "./verifier.js";

export interface ProvenanceContext {
  registry?: VerificationKeyRegistryLike;
  signal?: AbortSignal;
}
export interface ProvenanceVerifier {
  readonly type: string;
  verify(attestation: InputAttestation, context: ProvenanceContext): Promise<boolean>;
}

// oracle-sig-v1: proof = base64url(ed25519 signature over
// utf8(jcs({type, source, commitment}))), key is a PEM fetched via the
// origin-allowlisted registry at verificationKeyUri (pinned by URI).
export class OracleSigVerifier implements ProvenanceVerifier {
  readonly type = "oracle-sig-v1";
  async verify(attestation: InputAttestation, context: ProvenanceContext): Promise<boolean> {
    const { proof, verificationKeyUri } = attestation;
    if (!proof || !verificationKeyUri || !context.registry) return false;
    if (attestationCommitment(attestation.data) !== attestation.commitment) return false;
    try {
      const key = await context.registry.get(`oracle-sig-v1:${verificationKeyUri}`, verificationKeyUri);
      const message = new TextEncoder().encode(jcs({ type: attestation.type, source: attestation.source, commitment: attestation.commitment }));
      const signature = Buffer.from(proof, "base64url");
      return verifySignature(null, message, key as Parameters<typeof verifySignature>[2], signature);
    } catch { return false; }
  }
}

export type ProvenanceOutcome =
  | { ok: true }
  | { ok: false; reason: "provenanceMissing" | "provenanceMalformed" | "provenanceUnbound" | "provenanceUnsupported" | "provenanceInvalid" };

export async function verifyProvenance(meta: VerifiableToolsMeta, options: {
  required: boolean;
  verifiers: ProvenanceVerifier[];
  registry?: VerificationKeyRegistryLike;
  signal?: AbortSignal;
}): Promise<ProvenanceOutcome> {
  const attestations = meta.inputAttestations;
  if (!Array.isArray(attestations) || attestations.length === 0) {
    return options.required ? { ok: false, reason: "provenanceMissing" } : { ok: true };
  }
  for (const raw of attestations) {
    const attestation = parseInputAttestation(raw as unknown as JsonValue);
    if (!attestation) return { ok: false, reason: "provenanceMalformed" };
    if (!meta.publicInputs?.includes(attestation.commitment)) return { ok: false, reason: "provenanceUnbound" };
    if (attestationCommitment(attestation.data) !== attestation.commitment) return { ok: false, reason: "provenanceInvalid" };
    const verifier = options.verifiers.find((candidate) => candidate.type === attestation.type);
    if (!verifier) return { ok: false, reason: "provenanceUnsupported" };
    options.signal?.throwIfAborted();
    try {
      if (!(await verifier.verify(attestation, { registry: options.registry, signal: options.signal }))) return { ok: false, reason: "provenanceInvalid" };
    } catch (error) {
      if (options.signal?.aborted) throw error;
      return { ok: false, reason: "provenanceInvalid" };
    }
  }
  return { ok: true };
}
