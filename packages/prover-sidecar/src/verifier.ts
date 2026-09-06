import { Verifier, VerifyContext } from "@demo/verifier";
import { VerifiableToolsMeta } from "@demo/protocol";
import { SidecarVerifyResponse, readJsonBounded } from "./contract.js";

export class SidecarVerifier implements Verifier {
  private readonly baseUrl: string;
  readonly format: string;
  private readonly timeoutMs: number;
  constructor(options: { baseUrl: string; format: string; timeoutMs?: number }) {
    this.baseUrl = options.baseUrl;
    this.format = options.format;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }
  async verify(meta: VerifiableToolsMeta, context: VerifyContext): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ meta, expectedCircuitHash: context.expectedCircuitHash }),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
      if (!response.ok) return false;
      const body = await readJsonBounded(response) as SidecarVerifyResponse;
      return body.ok === true;
    } catch { return false; }
  }
}
