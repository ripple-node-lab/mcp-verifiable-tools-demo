// In-process oracle price feed for the demo: deterministic per-symbol prices,
// attested as an oracle-sig-v1 InputAttestation so the riskScore proof binds
// the external input commitment in publicInputs.
import { createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { InputAttestation, JsonValue, attestationCommitment, b64u, jcs, parseInputAttestation } from "@demo/protocol";
import { readJsonBounded } from "@demo/prover-sidecar";

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

// zktls-tlsn-v1 price feed: fetches the fixture exchange through the TLSNotary
// sidecar; /attest returns the attested InputAttestation directly.
const TLSN_SYMBOL_PATTERN = /^[A-Za-z0-9._-]{1,16}$/;
export class TlsnPriceFeed implements PriceFeed {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  constructor(options: { baseUrl: string; timeoutMs?: number }) {
    this.baseUrl = options.baseUrl;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }
  async fetch(symbol: string, signal?: AbortSignal): Promise<{ price: number; attestation: InputAttestation }> {
    if (!TLSN_SYMBOL_PATTERN.test(symbol)) throw new Error(`invalid price symbol: ${symbol}`);
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const response = await fetch(`${this.baseUrl}/attest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: `https://test-server.io/v1/price/${symbol}` }),
      signal: signal ? AbortSignal.any([timeout, signal]) : timeout
    });
    if (!response.ok) throw new Error(`tlsn /attest failed: ${response.status}`);
    const body = await readJsonBounded(response) as JsonValue;
    const attestation = parseInputAttestation(body);
    if (!attestation || attestation.type !== "zktls-tlsn-v1") throw new Error("tlsn /attest returned an invalid attestation");
    let price: number;
    try { price = (JSON.parse(attestation.data) as { price?: unknown }).price as number; }
    catch { throw new Error("tlsn /attest returned invalid data"); }
    if (!Number.isFinite(price)) throw new Error("tlsn /attest returned invalid data");
    return { price, attestation };
  }
}
