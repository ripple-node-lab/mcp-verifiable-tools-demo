import { JsonValue, VerifiableToolsMeta } from "@demo/protocol";
export interface ProveInput {
  circuitHash: string;
  inputCommitment: string;
  output: string;
}
export interface Prover {
  readonly format: string;
  prove(input: ProveInput): VerifiableToolsMeta;
}
export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
export function canonicalJson(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
import { createHash } from "node:crypto";
