import { randomBytes } from "node:crypto";
import { CallToolResult, JsonValue, RESULT_TTL_MS } from "@demo/protocol";

export interface StoredResult {
  tool: string;
  arguments: JsonValue;
  salt?: Uint8Array;
  content: CallToolResult["content"];
  nonce?: string;
  replyPublicKey?: string;
  createdAt: number;
}

export type StoredResultLookup = StoredResult | "expired" | undefined;

export class ResultStore {
  private readonly results = new Map<string, StoredResult>();
  private readonly expired = new Map<string, number>();
  private readonly sweepTimer: ReturnType<typeof setInterval>;
  constructor(private readonly ttlMs = RESULT_TTL_MS) {
    this.sweepTimer = setInterval(() => this.sweep(), Math.min(this.ttlMs, 1000));
    (this.sweepTimer as unknown as { unref?: () => void }).unref?.();
  }
  get retentionMs(): number { return this.ttlMs; }
  get witnessCount(): number { return this.results.size; }
  put(value: Omit<StoredResult, "createdAt">): string {
    this.sweep();
    const resultId = randomBytes(16).toString("hex");
    this.results.set(resultId, { ...value, createdAt: Date.now() });
    return resultId;
  }
  get(resultId: string): StoredResultLookup {
    this.sweep();
    const value = this.results.get(resultId);
    if (value) return value;
    return this.expired.has(resultId) ? "expired" : undefined;
  }
  close(): void { clearInterval(this.sweepTimer); }
  private sweep(): void {
    const now = Date.now();
    for (const [id, value] of this.results) {
      if (value.createdAt + this.ttlMs <= now) {
        this.results.delete(id);
        this.expired.set(id, value.createdAt + this.ttlMs);
      }
    }
    for (const [id, expiresAt] of this.expired) {
      if (expiresAt + this.ttlMs * 2 <= now) this.expired.delete(id);
    }
  }
}
