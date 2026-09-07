import { EXTENSION_ID, PROTOCOL_VERSION, TASKS_EXTENSION_ID, META_SERVER_INFO } from "@demo/protocol";
import { JsonRpcResponse } from "@demo/protocol";
export function discoveryExtensions(proofFormats: string[], blindPublicKey: string, resultTtlMs: number): Record<string, unknown> {
  return {
    [EXTENSION_ID]: {
      proofFormats: [...proofFormats],
      blindExecution: true,
      blindEncryptionSchemes: ["hpke-v1"],
      blindPublicKeys: { "hpke-v1": blindPublicKey },
      resultTtlMs
    },
    [TASKS_EXTENSION_ID]: {}
  };
}
export function discoverResponse(id: string | number | null, proofFormats: string[], blindPublicKey: string, resultTtlMs: number): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    result: {
      resultType: "complete",
      supportedVersions: [PROTOCOL_VERSION],
      capabilities: {
        tools: {},
        extensions: discoveryExtensions(proofFormats, blindPublicKey, resultTtlMs)
      },
      _meta: { [META_SERVER_INFO]: { name: "verifiable-tools-demo", version: "1.0.0" } }
    }
  };
}
