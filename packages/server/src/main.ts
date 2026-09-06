import { startServer } from "./index.js";
const port = Number(process.env.PORT ?? "3939");
const server = await startServer({
  port,
  risc0SidecarUrl: process.env.RISC0_SIDECAR_URL,
  risc0TimeoutMs: process.env.RISC0_SIDECAR_TIMEOUT_MS ? Number(process.env.RISC0_SIDECAR_TIMEOUT_MS) : undefined,
  ezklSidecarUrl: process.env.EZKL_SIDECAR_URL,
  tlsnSidecarUrl: process.env.TLSN_SIDECAR_URL,
});
console.log(`verifiable-tools server listening at ${server.mcpUrl}`);
