// Phase 4-a: bridge the verifiable-tools extension onto the published
// @modelcontextprotocol/sdk@1.30.0 Server. The SDK owns transport and the
// initialize handshake; DemoServer.dispatch still owns JSON-RPC semantics.
// The SDK negotiates 2025-11-25 at initialize (its LATEST_PROTOCOL_VERSION —
// 2026-07-28 is not yet published in v1.x); our extension keeps carrying
// io.modelcontextprotocol/protocolVersion in request _meta as before.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import { JsonValue } from "@demo/protocol";
import { DemoServer } from "@demo/server";

const REQUEST_METHODS = [
  "server/discover",
  "tools/list",
  "tools/call",
  "verifiable-tools/call",
  "verifiable-tools/prove"
] as const;

type DispatchResponse = { result?: unknown; error?: { code: number; message: string; data?: unknown } };
type Dispatchable = { dispatch(request: { jsonrpc: "2.0"; id: string | number | null; method: string; params?: JsonValue }): Promise<DispatchResponse> };

function handlerFor(demo: Dispatchable, method: string) {
  return async (request: { id?: string | number; params?: unknown }) => {
    const response = await demo.dispatch({
      jsonrpc: "2.0",
      id: (request.id as string | number | null | undefined) ?? null,
      method,
      params: request.params as JsonValue | undefined
    });
    if (response.error) {
      throw new McpError(response.error.code, response.error.message, response.error.data);
    }
    return response.result ?? {};
  };
}

export function attachVerifiableTools(server: Server, demo: DemoServer): void {
  server.registerCapabilities({ tools: {}, extensions: demo.discoveryExtensions as Record<string, object> });
  for (const method of REQUEST_METHODS) {
    server.setRequestHandler(
      z.looseObject({ method: z.literal(method), params: z.looseObject({}).optional() }),
      handlerFor(demo, method)
    );
  }
  // SDK 1.30.0 gates setRequestHandler("tasks/*") behind the *server* tasks
  // capability (assertRequestHandlerCapability), which would advertise the
  // SDK-native tasks shape rather than the io.modelcontextprotocol/tasks
  // extension we declare. Route the two methods we implement through the
  // fallback handler instead; unrelated methods keep MethodNotFound.
  const fallback = server.fallbackRequestHandler;
  server.fallbackRequestHandler = async (request, extra) => {
    if (request.method === "tasks/get" || request.method === "tasks/cancel") {
      return handlerFor(demo, request.method)(request);
    }
    if (fallback) return fallback(request, extra);
    throw new McpError(ErrorCode.MethodNotFound, "Method not found");
  };
}

export function createVerifiableServer(demo: DemoServer, serverInfo: { name: string; version: string } = { name: "verifiable-tools-demo", version: "1.0.0" }): Server {
  const server = new Server(serverInfo);
  attachVerifiableTools(server, demo);
  return server;
}
