import { DemoServer } from "@demo/server";
export async function withServer<T>(fn: (server: DemoServer) => Promise<T>): Promise<T> {
  const server = new DemoServer();
  await server.listen(0);
  try { return await fn(server); } finally { await server.close(); }
}
export async function rpc(server: DemoServer, method: string, params: Record<string, unknown>, extraHeaders: Record<string, string> = {}): Promise<{ result?: Record<string, unknown>; error?: { code: number; message: string } }> {
  const headers: Record<string, string> = { "content-type": "application/json", "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": method, ...extraHeaders };
  const response = await fetch(server.mcpUrl, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  return await response.json() as { result?: Record<string, unknown>; error?: { code: number; message: string } };
}
