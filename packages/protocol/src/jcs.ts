import { createHash } from "node:crypto";
import { JsonValue } from "./types.js";

export function jcs(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(jcs).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${jcs(value[key]!)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256Hex(...parts: (string | Uint8Array)[]): string {
  const hash = createHash("sha256");
  const bytes = parts.map((part) => typeof part === "string" ? new TextEncoder().encode(part) : part);
  const joined = new Uint8Array(bytes.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of bytes) { joined.set(part, offset); offset += part.length; }
  return `0x${hash.update(joined).digest("hex")}`;
}
