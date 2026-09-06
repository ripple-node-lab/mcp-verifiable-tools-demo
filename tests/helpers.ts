import assert from "node:assert/strict";
import { after } from "node:test";
import { CallToolResult } from "@demo/protocol";
import { DemoServer, DemoServerOptions } from "@demo/server";
import { destroy as destroyNoir } from "@demo/prover-noir";
import { closeProverWorker as closeNoirWorker } from "@demo/prover-noir";
import { closeProverWorker as closeSnarkjsWorker } from "@demo/prover-snarkjs";
import type { TaskEnvelope } from "@demo/client";
after(async () => {
  closeSnarkjsWorker();
  closeNoirWorker();
  await destroyNoir();
});
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
export async function waitForTaskWorking(server: DemoServer, taskId: string, minimumMs = 50): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < minimumMs) {
    const current = await rpc(server, "tasks/get", { taskId });
    if (current.result?.status !== "working") throw new Error(`task stopped working: ${String(current.result?.status)}`);
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}
export async function waitForControllersGone(server: DemoServer, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (server.tasks.controllerCount !== 0 && Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}
