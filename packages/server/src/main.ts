import { startServer } from "./index.js";
const port = Number(process.env.PORT ?? "3939");
const server = await startServer({ port, risc0SidecarUrl: process.env.RISC0_SIDECAR_URL });
console.log(`verifiable-tools server listening at ${server.mcpUrl}`);
