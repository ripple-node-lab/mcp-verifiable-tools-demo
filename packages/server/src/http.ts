import { IncomingMessage, ServerResponse } from "node:http";
import { JsonRpcError, JsonRpcRequest, JsonRpcResponse, JsonValue } from "@demo/protocol";
import type { DemoServer } from "./index.js";
export async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}
export function send(response: ServerResponse, status: number, body: JsonRpcResponse): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(body));
}
export function errorResponse(id: string | number | null, code: number, message: string): JsonRpcResponse {
  const error: JsonRpcError = { code, message };
  return { jsonrpc: "2.0", id, error };
}
export function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { jsonrpc?: unknown; id?: unknown; method?: unknown };
  return candidate.jsonrpc === "2.0" && (typeof candidate.id === "string" || typeof candidate.id === "number" || candidate.id === null) && typeof candidate.method === "string";
}
export function paramsRecord(params: unknown): { [key: string]: JsonValue } | undefined {
  return typeof params === "object" && params !== null && !Array.isArray(params) ? params as { [key: string]: JsonValue } : undefined;
}
export async function handleMcpPost(server: DemoServer, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const id = null;
  const contentType = request.headers["content-type"];
  if (request.method !== "POST" || typeof contentType !== "string" || !contentType.toLowerCase().startsWith("application/json")) {
    send(response, 400, errorResponse(id, -32600, "Invalid Request"));
    return;
  }
  let raw: unknown;
  try { raw = await readJson(request); } catch { send(response, 400, errorResponse(id, -32600, "Invalid Request")); return; }
  if (!isJsonRpcRequest(raw)) { send(response, 400, errorResponse(id, -32600, "Invalid Request")); return; }
  const requestId = raw.id;
  const protocolVersion = request.headers["mcp-protocol-version"];
  const mcpMethod = request.headers["mcp-method"];
  const nameHeader = request.headers["mcp-name"];
  const params = paramsRecord(raw.params);
  const name = params && typeof params.name === "string" ? params.name : undefined;
  if (protocolVersion !== "2026-07-28" || mcpMethod !== raw.method || (raw.method === "tools/call" && (nameHeader === undefined || nameHeader !== name))) {
    send(response, 400, errorResponse(requestId, -32600, "Invalid Request"));
    return;
  }
  send(response, 200, await server.dispatch(raw));
}
