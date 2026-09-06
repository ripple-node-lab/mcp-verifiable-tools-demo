import { CallToolResult, EXTENSION_ID, JsonRpcProtocolError, JsonValue, ToolDescriptorMeta, expectedCircuitHash, inputCommitment as protocolInputCommitment, parseAddArguments } from "@demo/protocol";
import { add } from "./tools/add.js";
import { privateCreditCheck } from "./tools/creditCheck.js";
import { riskScore } from "./tools/riskScore.js";
export type ToolName = "add" | "riskScore" | "privateCreditCheck" | "priceQuote";
export interface ToolExecution { output: string; arguments: JsonValue; }
export type DescriptorOverride = (tool: string, descriptor: ToolDescriptorMeta) => ToolDescriptorMeta | undefined;
export type ToolFormatDescriptor = (circuitHash: string) => { circuitHash?: string; verificationKeyUri?: string };
export function isZkFormat(format: string): boolean {
  return format === "snarkjs-v2" || format === "noir-v1";
}
export function toolList(baseUrl: string, proofFormats: string[], formatDescriptors: { [format: string]: ToolFormatDescriptor } = {}, override?: DescriptorOverride): JsonValue {
  const definitions: Array<{ name: ToolName; description: string; inputSchema: JsonValue; proofPolicy: ToolDescriptorMeta["proofPolicy"]; blind: boolean }> = [
    { name: "add", description: "Add two numbers", inputSchema: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } }, required: ["a", "b"] }, proofPolicy: "always", blind: false },
    { name: "riskScore", description: "Calculate a deterministic risk score", inputSchema: { type: "object", properties: { symbol: { type: "string" } }, required: ["symbol"] }, proofPolicy: "always", blind: false },
    { name: "privateCreditCheck", description: "Check credit eligibility without revealing arguments", inputSchema: { type: "object", properties: { income: { type: "number" }, debt: { type: "number" } }, required: ["income", "debt"] }, proofPolicy: "always", blind: true },
    { name: "priceQuote", description: "Calculate a deterministic price quote", inputSchema: { type: "object", properties: { symbol: { type: "string" } }, required: ["symbol"] }, proofPolicy: "onDemand", blind: false }
  ];
  return definitions.map(({ name, description, inputSchema, proofPolicy, blind }) => {
    const hash = expectedCircuitHash(name);
    // ZK circuits are compiled for `add` only; other formats apply to every tool.
    const toolFormats = proofFormats.filter((format) => !isZkFormat(format) || name === "add");
    const descriptor: ToolDescriptorMeta = {
      circuitHash: hash,
      proofFormats: toolFormats,
      proofPolicy,
      verificationKeyUri: `${baseUrl}/vk/${hash}`,
      blind,
      formats: Object.fromEntries(toolFormats.map((format) => [format, format === "demo-sig-v1"
        ? { circuitHash: hash, verificationKeyUri: `${baseUrl}/vk/${hash}` }
        : format === "demo-commit-v1"
          ? { circuitHash: hash }
          : isZkFormat(format)
            ? { circuitHash: expectedCircuitHash(name, format), verificationKeyUri: `${baseUrl}/vk/${expectedCircuitHash(name, format)}` }
            : (formatDescriptors[format]?.(hash) ?? {})]))
    };
    const overridden = override ? override(name, descriptor) : descriptor;
    return { name, description, inputSchema, ...(overridden ? { _meta: { [EXTENSION_ID]: overridden as unknown as JsonValue } } : {}) };
  });
}
export function executeTool(name: ToolName, args: JsonValue, zk = false): ToolExecution {
  if (!isObject(args)) throw new JsonRpcProtocolError(-32602, "arguments must be an object");
  if (name === "add" && typeof args.a === "number" && typeof args.b === "number" &&
      (!zk || parseAddArguments(args) !== undefined)) return { output: String(add(args.a, args.b)), arguments: args };
  if (name === "riskScore" && typeof args.symbol === "string") return { output: String(riskScore(args.symbol)), arguments: args };
  if (name === "privateCreditCheck" && typeof args.income === "number" && typeof args.debt === "number") return { output: privateCreditCheck(args.income, args.debt), arguments: args };
  if (name === "priceQuote" && typeof args.symbol === "string") return { output: String(riskScore(args.symbol) * 7 + 100), arguments: args };
  throw new JsonRpcProtocolError(-32602, `invalid arguments for ${name}`);
}
export function inputCommitment(args: JsonValue, salt?: Uint8Array): string {
  return protocolInputCommitment(args, salt);
}
export function circuitHash(name: ToolName): string {
  return expectedCircuitHash(name);
}
export function makeResult(output: string, meta?: Record<string, JsonValue>, content?: CallToolResult["content"]): CallToolResult {
  return { resultType: "complete", content: content ?? [{ type: "text", text: output }], isError: false, ...(meta ? { _meta: meta } : {}) };
}
function isObject(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
