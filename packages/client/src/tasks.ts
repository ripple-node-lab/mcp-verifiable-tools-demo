import { CallToolResult, JsonValue, RequestMeta } from "@demo/protocol";
import type { TaskEnvelope } from "./client.js";
export type RpcRequest = (method: string, params: unknown) => Promise<{ result?: unknown; error?: { code: number; message: string } }>;
export async function pollTask(request: RpcRequest, task: TaskEnvelope, meta: RequestMeta): Promise<CallToolResult> {
  const deadline = Date.now() + (task.ttlMs ?? 60000);
  while (true) {
    if (Date.now() > deadline) throw new Error("task polling timed out");
    const response = await request("tasks/get", { taskId: task.taskId, _meta: meta });
    if (response.error) throw new Error(response.error.message);
    const current = asRecord(response.result);
    if (current.status === "completed" && current.result) return current.result as unknown as CallToolResult;
    if (current.status !== "working") throw new Error(`task ${String(current.status)}`);
    await new Promise<void>((resolve) => setTimeout(resolve, Number(current.pollIntervalMs)));
  }
}
function asRecord(value: unknown): { [key: string]: JsonValue } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("malformed task response");
  return value as { [key: string]: JsonValue };
}
