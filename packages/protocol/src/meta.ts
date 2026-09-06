import { EXTENSION_ID, META_CLIENT_CAPABILITIES, META_VERIFIABLE_TOOLS, TASKS_EXTENSION_ID } from "./constants.js";
import { ClientCapabilities, JsonValue, RequestMeta, VerifiableToolsCapability } from "./types.js";
import { createHash } from "node:crypto";

export function clientCapabilities(proofFormats: string[], options: { blindExecution?: boolean; requireProof?: boolean; tasks?: boolean } = {}): ClientCapabilities {
  const extensions: { [key: string]: VerifiableToolsCapability | Record<string, never> } = {
    [EXTENSION_ID]: { proofFormats, ...(options.blindExecution === undefined ? {} : { blindExecution: options.blindExecution }), ...(options.requireProof === undefined ? {} : { requireProof: options.requireProof }) }
  };
  if (options.tasks) extensions[TASKS_EXTENSION_ID] = {};
  return { extensions };
}
export function capabilitiesFromMeta(meta: RequestMeta | undefined): ClientCapabilities | undefined {
  return meta?.[META_CLIENT_CAPABILITIES];
}
export function verifiableCapability(capabilities: ClientCapabilities | undefined): VerifiableToolsCapability | undefined {
  const value = capabilities?.extensions?.[EXTENSION_ID];
  return value && "proofFormats" in value ? value : value ? {} : undefined;
}
export function tasksDeclared(capabilities: ClientCapabilities | undefined): boolean {
  return Boolean(capabilities?.extensions?.[TASKS_EXTENSION_ID]);
}
export function negotiateProofFormat(clientCap: VerifiableToolsCapability | undefined, serverFormats: readonly string[], requested?: string): string | undefined {
  if (!clientCap) return undefined;
  const clientFormats = clientCap.proofFormats ?? [];
  if (requested !== undefined) return clientFormats.includes(requested) && serverFormats.includes(requested) ? requested : undefined;
  return serverFormats.find((format) => clientFormats.includes(format));
}
export function requestMeta(capabilities: ClientCapabilities, clientInfo = { name: "demo-client", version: "1.0.0" }): RequestMeta {
  return {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientInfo": clientInfo,
    [META_CLIENT_CAPABILITIES]: capabilities
  };
}
export function isRecord(value: unknown): value is { [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function circuitHash(tool: string): string {
  return `0x${createHash("sha256").update(`verifiable-tools-demo:${tool}:v1`).digest("hex")}`;
}
function pinned(tool: string): { default: string; formats: { [format: string]: string } } {
  const hash = circuitHash(tool);
  return { default: hash, formats: { "demo-sig-v1": hash, "demo-commit-v1": hash } };
}
export const PINNED_CIRCUITS: { [tool: string]: { default: string; formats?: { [format: string]: string } } } = {
  add: {
    default: circuitHash("add"),
    formats: {
      "snarkjs-v2": "0xfb5e4566f5be574f3e95c0356e19ecef88dabd0692edcf5f4be688106e9968c7",
      "noir-v1": "0x70d3e40690fb97fbcace5ce1d3114282e7dfff1387b125767b6a942e1ca3261e",
      "demo-sig-v1": circuitHash("add"),
      "demo-commit-v1": circuitHash("add")
    }
  },
  riskScore: pinned("riskScore"),
  privateCreditCheck: pinned("privateCreditCheck"),
  priceQuote: pinned("priceQuote")
};
export function expectedCircuitHash(tool: string, format?: string): string {
  const pin = PINNED_CIRCUITS[tool];
  return pin?.formats?.[format ?? ""] ?? pin?.default ?? circuitHash(tool);
}
