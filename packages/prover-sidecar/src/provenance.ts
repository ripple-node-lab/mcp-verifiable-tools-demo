// zktls-tlsn-v1 provenance verifier: delegates the TLSNotary Presentation
// verification to the Rust sidecar (tlsn-core does not build for bare
// wasm32). The notary key is pinned through the origin-allowlisted registry.
import { KeyObject } from "node:crypto";
import { InputAttestation } from "@demo/protocol";
import { ProvenanceContext, ProvenanceVerifier } from "@demo/verifier";
import { readJsonBounded } from "./contract.js";

export interface TlsnVerifyResponse {
  ok: boolean;
  serverName?: string;
  data?: string;
  reason?: string;
}

export class TlsnProvenanceVerifier implements ProvenanceVerifier {
  readonly type = "zktls-tlsn-v1";
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  constructor(options: { baseUrl: string; timeoutMs?: number }) {
    this.baseUrl = options.baseUrl;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }
  async verify(attestation: InputAttestation, context: ProvenanceContext): Promise<boolean> {
    const { proof, notaryKeyUri } = attestation;
    if (!proof || !notaryKeyUri || !context.registry) return false;
    try {
      const key = await context.registry.get(`zktls-tlsn-v1:${notaryKeyUri}`, notaryKeyUri);
      const notaryKeyPem = String((key as KeyObject).export({ type: "spki", format: "pem" }));
      const timeout = AbortSignal.timeout(this.timeoutMs);
      const response = await fetch(`${this.baseUrl}/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ attestation, notaryKeyPem }),
        signal: context.signal ? AbortSignal.any([timeout, context.signal]) : timeout
      });
      if (!response.ok) return false;
      const body = await readJsonBounded(response) as TlsnVerifyResponse;
      return body.ok === true &&
        body.data === attestation.data &&
        body.serverName === new URL(attestation.source).host;
    } catch (error) {
      if (context.signal?.aborted) throw error;
      return false;
    }
  }
}
