import { createPublicKey, KeyObject } from "node:crypto";
export class VerificationKeyRegistry {
  private readonly keys = new Map<string, string>();
  async get(circuitHash: string, uri: string): Promise<KeyObject> {
    const pem = await fetch(uri).then(async (response) => {
      if (!response.ok) throw new Error(`verification key fetch failed: ${response.status}`);
      return response.text();
    });
    const previous = this.keys.get(circuitHash);
    if (previous !== undefined && previous !== pem) throw new Error("verification key pin mismatch");
    this.keys.set(circuitHash, pem);
    return createPublicKey({ key: pem, format: "pem" });
  }
}
