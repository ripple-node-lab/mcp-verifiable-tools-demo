import { startMockSidecar } from "./index.js";

const port = Number(process.env.PORT ?? "4100");
const host = process.env.HOST ?? "0.0.0.0";
const sidecar = await startMockSidecar(port, host);
process.stdout.write(`sidecar-mock listening on ${sidecar.url}\n`);
