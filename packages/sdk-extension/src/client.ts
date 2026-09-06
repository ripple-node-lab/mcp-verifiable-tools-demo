// Phase 4-a client side: adapt an SDK Client so VerifiableClient can run its
// JSON-RPC over the SDK transport instead of raw fetch. The client declares
// the extension in initialize's capabilities.extensions; our per-request
// _meta (clientCapabilities / protocolVersion / clientInfo) is unchanged.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import { EXTENSION_ID, clientCapabilities } from "@demo/protocol";
import { VerifiableClient, VerifiableClientOptions, RpcTransport } from "@demo/client";

// SDK ServerCapabilities "extensions" shape for the client's initialize call.
export function verifiableClientCapabilities(proofFormats: string[], options: { blindExecution?: boolean; requireProof?: boolean; tasks?: boolean; requireInputProvenance?: boolean } = {}): { extensions: Record<string, object> } {
  return { extensions: clientCapabilities(proofFormats, options).extensions as Record<string, object> };
}

// JSON-RPC over the SDK transport: result on success, McpError -> { error }.
export function sdkRpc(client: Client): RpcTransport {
  const resultSchema = z.looseObject({});
  return async (method, params) => {
    try {
      const result = await client.request({ method, params: params as Record<string, unknown> }, resultSchema);
      return { result };
    } catch (error) {
      if (error instanceof McpError) {
        // McpError prefixes its message with "MCP error <code>: "; the prefix is
        // already embedded once on the wire, so strip it for message parity
        // with the raw JSON-RPC transport.
        let message = error.message;
        while (message.startsWith("MCP error ")) message = message.replace(/^MCP error -?\d+:\s*/, "");
        return { error: { code: error.code, message, data: error.data } };
      }
      throw error;
    }
  };
}

export function assertServerSupportsVerifiableTools(client: Client): void {
  const extensions = client.getServerCapabilities()?.extensions;
  if (!extensions || !(EXTENSION_ID in extensions)) {
    throw new Error(`server does not advertise the ${EXTENSION_ID} extension in initialize capabilities`);
  }
}

export function createVerifiableClient(client: Client, registryOrigin: string, options: Omit<VerifiableClientOptions, "rpc"> = {}): VerifiableClient {
  assertServerSupportsVerifiableTools(client);
  return new VerifiableClient(registryOrigin, { ...options, rpc: sdkRpc(client) });
}
