// In-process oracle price feed for the demo: deterministic per-symbol prices,
// attested as an oracle-sig-v1 InputAttestation so the riskScore proof binds
// the external input commitment in publicInputs.
import { createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { InputAttestation, JsonValue, attestationCommitment, b64u, jcs } from "@demo/protocol";

export interface PriceFeed {
  fetch(symbol: string, signal?: AbortSignal): Promise<{ price: number; attestation: InputAttestation }>;
}

// Demo price source: a deterministic per-symbol USD price.
export function demoPrice(symbol: string): number {
  let total = 0;
  for (const character of symbol) total += character.charCodeAt(0);
  return 100 + (total % 400);
}

export class OraclePriceFeed implements PriceFeed {
  private readonly privateKey: Parameters<typeof sign>[2];
  readonly publicKey: ReturnType<typeof createPublicKey>;
  constructor(private readonly baseUrl: () => string) {
    const pair = generateKeyPairSync("ed25519");
    this.privateKey = pair.privateKey;
    this.publicKey = pair.publicKey;
  }
  get verificationKeyUri(): string { return `${this.baseUrl()}/oracle-keys/demo`; }
  async fetch(symbol: string): Promise<{ price: number; attestation: InputAttestation }> {
    const type = "oracle-sig-v1";
    const source = `oracle://demo-exchange/v1/price/${symbol}`;
    const price = demoPrice(symbol);
    const data = jcs({ symbol, price, currency: "USD" } as unknown as JsonValue);
    const commitment = attestationCommitment(data);
    const signature = sign(null, new TextEncoder().encode(jcs({ type, source, commitment } as unknown as JsonValue)), this.privateKey);
    return {
      price,
      attestation: { type, source, commitment, data, proof: b64u(new Uint8Array(signature)), verificationKeyUri: this.verificationKeyUri }
    };
  }
}
