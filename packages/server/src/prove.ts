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
  constructor(private readonly ttlMs = RESULT_TTL_MS) {}
  put(value: Omit<StoredResult, "createdAt">): string {
    this.sweep();
    const resultId = randomBytes(16).toString("hex");
    this.results.set(resultId, { ...value, createdAt: Date.now() });
    return resultId;
  }
  get(resultId: string): StoredResultLookup {
    const value = this.results.get(resultId);
    if (!value) return undefined;
    if (value.createdAt + this.ttlMs <= Date.now()) {
      this.results.delete(resultId);
      return "expired";
    }
    return value;
  }
  private sweep(): void {
    const now = Date.now();
    for (const [id, value] of this.results) if (value.createdAt + this.ttlMs <= now) this.results.delete(id);
  }
}
