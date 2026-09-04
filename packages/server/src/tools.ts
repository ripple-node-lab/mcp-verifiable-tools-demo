import { CallToolResult, JsonValue } from "@demo/protocol";
import { canonicalJson } from "@demo/prover";
import { DemoCommitProver, DemoSigProver, Prover } from "@demo/prover";
import { add } from "./tools/add.js";
import { privateCreditCheck } from "./tools/creditCheck.js";
import { riskScore } from "./tools/riskScore.js";
import { createHash } from "node:crypto";
export type ToolName = "add" | "riskScore" | "privateCreditCheck";
export interface ToolExecution { output: string; arguments: JsonValue; }
export function toolList(): JsonValue {
  return [
    { name: "add", description: "Add two numbers", inputSchema: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } }, required: ["a", "b"] } },
    { name: "riskScore", description: "Calculate a deterministic risk score", inputSchema: { type: "object", properties: { symbol: { type: "string" } }, required: ["symbol"] } },
    { name: "privateCreditCheck", description: "Check credit eligibility without revealing arguments", inputSchema: { type: "object", properties: { income: { type: "number" }, debt: { type: "number" } }, required: ["income", "debt"] } }
  ];
}
export function executeTool(name: ToolName, args: JsonValue): ToolExecution {
  if (!isObject(args)) throw new Error("arguments must be an object");
  if (name === "add" && typeof args.a === "number" && typeof args.b === "number") return { output: String(add(args.a, args.b)), arguments: args };
  if (name === "riskScore" && typeof args.symbol === "string") return { output: String(riskScore(args.symbol)), arguments: args };
  if (name === "privateCreditCheck" && typeof args.income === "number" && typeof args.debt === "number") return { output: privateCreditCheck(args.income, args.debt), arguments: args };
  throw new Error(`invalid arguments for ${name}`);
}
export function inputCommitment(args: JsonValue): string {
  return `0x${createHash("sha256").update(canonicalJson(args)).digest("hex")}`;
}
export function circuitHash(name: ToolName): string {
  return `0x${createHash("sha256").update(`verifiable-tools-demo:${name}:v1`).digest("hex")}`;
}
export function makeResult(output: string, meta?: Record<string, JsonValue>): CallToolResult {
  return { resultType: "complete", content: [{ type: "text", text: output }], isError: false, ...(meta ? { _meta: meta } : {}) };
}
function isObject(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function proverFor(format: string): Prover {
  if (format === "demo-sig-v1") return new DemoSigProver();
  if (format === "demo-commit-v1") return new DemoCommitProver();
  throw new Error("unsupported proof format");
}
