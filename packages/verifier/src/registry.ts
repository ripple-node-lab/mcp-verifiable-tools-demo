import { createPublicKey, KeyObject } from "node:crypto";
export class VerificationKeyRegistry {
  private readonly keys = new Map<string, string>();
  constructor(private readonly allowedOrigins: string[]) {}
  async get(circuitHash: string, uri: string): Promise<KeyObject> {
    const cached = this.keys.get(circuitHash);
    if (cached !== undefined) return createPublicKey({ key: cached, format: "pem" });
    let origin: string;
    try { origin = new URL(uri).origin; } catch { throw new Error("verification key URI origin not allowed"); }
    if (!this.allowedOrigins.includes(origin)) throw new Error("verification key URI origin not allowed");
    const pem = await fetch(uri, { signal: AbortSignal.timeout(5000) }).then(async (response) => {
      if (!response.ok) throw new Error(`verification key fetch failed: ${response.status}`);
      const contentLength = response.headers?.get("content-length") ?? null;
      if (contentLength !== null && Number(contentLength) > 16 * 1024) throw new Error("verification key response too large");
      const text = await response.text();
      if (Buffer.byteLength(text) > 16 * 1024) throw new Error("verification key response too large");
      return text;
    });
    const previous = this.keys.get(circuitHash);
    if (previous !== undefined && previous !== pem) throw new Error("verification key pin mismatch");
    this.keys.set(circuitHash, pem);
    return createPublicKey({ key: pem, format: "pem" });
  }
}
