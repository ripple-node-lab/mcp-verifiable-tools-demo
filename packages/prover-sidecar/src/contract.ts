// HTTP contract between the MCP server and a proving sidecar.
//   GET  /healthz          -> SidecarHealth
//   POST /prove            -> ProveInput -> VerifiableToolsMeta (JSON)
//   POST /verify           -> SidecarVerifyRequest -> SidecarVerifyResponse
//   GET  /vk/{circuitHash} -> PEM verification key (formats that expose one)
import { ProveInput } from "@demo/prover";
import { VerifiableToolsMeta } from "@demo/protocol";

export interface SidecarHealth { status: "ok"; formats: string[]; }
export interface SidecarVerifyRequest { meta: VerifiableToolsMeta; expectedCircuitHash: string; }
export interface SidecarVerifyResponse { ok: boolean; reason?: string; }
export type { ProveInput, VerifiableToolsMeta };
