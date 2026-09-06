import assert from "node:assert/strict";
import { CallToolResult } from "@demo/protocol";
import { DemoServer, DemoServerOptions } from "@demo/server";
import type { TaskEnvelope } from "@demo/client";
export function expectComplete(value: CallToolResult | TaskEnvelope): CallToolResult {
  assert.equal(value.resultType, "complete");
  if (value.resultType !== "complete") throw new Error("expected complete result");
  return value;
}
export function expectTask(value: CallToolResult | TaskEnvelope): TaskEnvelope {
  assert.equal(value.resultType, "task");
  if (value.resultType !== "task") throw new Error("expected task result");
  return value;
}
export async function withServer<T>(fn: (server: DemoServer) => Promise<T>): Promise<T> {
  const server = new DemoServer();
  await server.listen(0);
  try { return await fn(server); } finally { await server.close(); }
}
export async function withServerOptions<T>(options: DemoServerOptions, fn: (server: DemoServer) => Promise<T>): Promise<T> {
  const server = new DemoServer(options);
  await server.listen(0);
  try { return await fn(server); } finally { await server.close(); }
}
export async function rpc(server: DemoServer, method: string, params: Record<string, unknown>, extraHeaders: Record<string, string> = {}): Promise<{ result?: Record<string, unknown>; error?: { code: number; message: string; data?: Record<string, unknown> } }> {
  const headers: Record<string, string> = { "content-type": "application/json", "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": method, ...extraHeaders };
  const response = await fetch(server.mcpUrl, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  return await response.json() as { result?: Record<string, unknown>; error?: { code: number; message: string; data?: Record<string, unknown> } };
}
