import { EXTENSION_ID, PROTOCOL_VERSION, SUPPORTED_PROOF_FORMATS, TASKS_EXTENSION_ID, META_SERVER_INFO } from "@demo/protocol";
import { JsonRpcResponse } from "@demo/protocol";
export function discoverResponse(id: string | number | null, blindPublicKey: string, resultTtlMs: number): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    result: {
      resultType: "complete",
      supportedVersions: [PROTOCOL_VERSION],
      capabilities: {
        tools: {},
        extensions: {
          [EXTENSION_ID]: {
            proofFormats: [...SUPPORTED_PROOF_FORMATS],
            blindExecution: true,
            blindEncryptionSchemes: ["hpke-v1"],
            blindPublicKeys: { "hpke-v1": blindPublicKey },
            resultTtlMs
          },
          [TASKS_EXTENSION_ID]: {}
        }
      },
      _meta: { [META_SERVER_INFO]: { name: "verifiable-tools-demo", version: "1.0.0" } }
    }
  };
}
