import { Prover, ProveInput } from "@demo/prover";
import { VerifiableToolsMeta } from "@demo/protocol";
import { readJsonBounded } from "./contract.js";

export class SidecarProver implements Prover {
  private readonly baseUrl: string;
  readonly format: string;
  private readonly timeoutMs: number;
  constructor(options: { baseUrl: string; format: string; timeoutMs?: number }) {
    this.baseUrl = options.baseUrl;
    this.format = options.format;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }
  async prove(input: ProveInput, options: { signal?: AbortSignal } = {}): Promise<VerifiableToolsMeta> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const signals = [timeout, ...(options.signal ? [options.signal] : [])];
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/prove`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
        signal: AbortSignal.any(signals)
      });
    } catch (error: unknown) {
      if (options.signal?.aborted) throw new DOMException("aborted", "AbortError");
      if (timeout.aborted) throw new Error("sidecar /prove timed out");
      throw error;
    }
    if (!response.ok) throw new Error(`sidecar /prove failed: ${response.status}`);
    const meta = await readJsonBounded(response) as VerifiableToolsMeta;
    if (meta.proofFormat !== this.format ||
      meta.circuitHash !== input.circuitHash ||
      meta.inputCommitment !== input.inputCommitment ||
      meta.outputCommitment !== input.outputCommitment ||
      meta.nonce !== input.nonce ||
      JSON.stringify(meta.inputAttestations) !== JSON.stringify(input.inputAttestations)) {
      throw new Error("sidecar returned mismatched proof metadata");
    }
    return meta;
  }
}
