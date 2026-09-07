// Phase 4-a client side: adapt an SDK Client so VerifiableClient can run its
// JSON-RPC over the SDK transport instead of raw fetch. The client declares
// the extension in initialize's capabilities.extensions; our per-request
// _meta (clientCapabilities / protocolVersion / clientInfo) is unchanged.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import { EXTENSION_ID, VerifiableToolsCapability, clientCapabilities } from "@demo/protocol";
import { VerifiableClient, VerifiableClientOptions, RpcTransport } from "@demo/client";

// One capability value feeds both the SDK Client constructor
// (verifiableClientCapabilities -> initialize's capabilities.extensions) and
// the VerifiableClient (createVerifiableClient -> setCapabilities -> per-request
// _meta clientCapabilities), so the two declarations cannot drift apart.
// SDK 1.30.0 has no public accessor for a Client's own declared capabilities,
// so the caller passes the same object to both.
export interface VerifiableExtensionCapability extends VerifiableToolsCapability { tasks?: boolean; }

const DEFAULT_REQUEST_TIMEOUT_MS = 200_000; // >= DemoServer's 180s risc0 default

// SDK ClientCapabilities "extensions" shape for the client's initialize call.
export function verifiableClientCapabilities(capability: VerifiableExtensionCapability): { extensions: Record<string, object> } {
  const { tasks, ...verifiable } = capability;
  return { extensions: clientCapabilities(verifiable.proofFormats ?? [], { ...verifiable, tasks }).extensions as Record<string, object> };
}

// JSON-RPC over the SDK transport: result on success, McpError -> { error }.
export function sdkRpc(client: Client, options: { timeoutMs?: number } = {}): RpcTransport {
  const resultSchema = z.looseObject({});
  const requestOptions = { timeout: options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS };
  return async (method, params) => {
    try {
      const result = await client.request({ method, params: params as Record<string, unknown> }, resultSchema, requestOptions);
      return { result };
    } catch (error) {
      if (error instanceof McpError) {
        // McpError prefixes its message with "MCP error <code>: "; the prefix is
        // already embedded once on the wire, so strip every well-formed prefix
        // for message parity with the raw JSON-RPC transport. Only strip a
        // prefix that actually has a numeric code (a bare "MCP error " with no
        // code must not loop forever).
        const prefix = /^MCP error -?\d+:\s*/;
        let message = error.message;
        while (prefix.test(message)) message = message.replace(prefix, "");
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

export function createVerifiableClient(
  client: Client,
  registryOrigin: string,
  capability: VerifiableExtensionCapability,
  options: Omit<VerifiableClientOptions, "rpc"> & { timeoutMs?: number } = {}
): VerifiableClient {
  assertServerSupportsVerifiableTools(client);
  if (!Array.isArray(capability.proofFormats) || capability.proofFormats.length === 0) {
    throw new Error(`capability.proofFormats for ${EXTENSION_ID} is required`);
  }
  const { timeoutMs, ...clientOptions } = options;
  const verifiable = new VerifiableClient(registryOrigin, { ...clientOptions, rpc: sdkRpc(client, { timeoutMs }) });
  verifiable.setCapabilities(capability, capability.tasks === true);
  return verifiable;
}
