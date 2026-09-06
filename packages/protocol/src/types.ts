import { EXTENSION_ID, TASKS_EXTENSION_ID, META_CLIENT_CAPABILITIES, META_CLIENT_INFO, META_PROTOCOL_VERSION, META_SERVER_INFO, META_VERIFIABLE_TOOLS } from "./constants.js";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type ProofFormat = "demo-sig-v1" | "demo-commit-v1" | string;
export interface VerifiableToolsCapability {
  proofFormats?: string[];
  blindExecution?: boolean;
  requireProof?: boolean;
  blindEncryptionSchemes?: string[];
  blindPublicKeys?: { [scheme: string]: string };
  resultTtlMs?: number;
  requireInputProvenance?: boolean;
}
export interface ClientCapabilities {
  extensions?: { [key: string]: VerifiableToolsCapability | Record<string, never> };
}
export interface ClientInfo { name: string; version: string; }
export interface ServerInfo { name: string; version: string; }
export interface VerifiableToolsMeta {
  proof?: string;
  proofFormat?: string;
  circuitHash?: string;
  verificationKeyUri?: string;
  publicInputs?: JsonValue[];
  inputCommitment?: string;
  outputCommitment?: string;
  nonce?: string;
  resultId?: string;
  encryptedContent?: boolean;
  proofUri?: string;
  teeAttestation?: string;
  inputAttestations?: JsonValue[];
  requestedProofFormat?: string;
}
export interface ToolDescriptorMeta {
  circuitHash: string;
  proofFormats: string[];
  proofPolicy: "always" | "onDemand" | "sampled";
  verificationKeyUri?: string;
  blind: boolean;
  formats?: { [format: string]: { circuitHash?: string; verificationKeyUri?: string } };
}
export interface ProveParams {
  resultId: string;
  proofFormat?: string;
  nonce?: string;
  _meta?: RequestMeta;
}
export interface RequestMeta {
  [META_PROTOCOL_VERSION]?: string;
  [META_CLIENT_CAPABILITIES]?: ClientCapabilities;
  [META_CLIENT_INFO]?: ClientInfo;
  [META_VERIFIABLE_TOOLS]?: VerifiableToolsMeta;
  [META_SERVER_INFO]?: ServerInfo;
}
export interface CallToolResult {
  resultType: "complete";
  content: Array<{ type: "text"; text: string }>;
  isError: boolean;
  _meta?: RequestMeta;
}
export interface TaskResult {
  resultType: "task";
  taskId: string;
  status: TaskStatus;
  createdAt: string;
  lastUpdatedAt: string;
  ttlMs: number;
  pollIntervalMs: number;
}
export type TaskStatus = "working" | "completed" | "failed" | "cancelled";
export interface Task {
  taskId: string;
  status: TaskStatus;
  createdAt: string;
  lastUpdatedAt: string;
  ttlMs: number;
  pollIntervalMs: number;
  result?: CallToolResult;
  error?: JsonRpcError;
}
export interface VerifiableCallParams {
  tool: string;
  inputCommitment: string;
  encryptionScheme: string;
  encryptedArguments: string;
  proofFormat?: string;
  replyPublicKey?: string;
  _meta?: RequestMeta;
}
export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number | null;
  method: string;
  params?: unknown;
}
export interface JsonRpcError { code: number; message: string; data?: unknown; }
export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: JsonRpcError;
}
export const extensionKeys = { verifiable: EXTENSION_ID, tasks: TASKS_EXTENSION_ID } as const;
