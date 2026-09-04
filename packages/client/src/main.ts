import { startServer } from "@demo/server";
import { VerifiableClient } from "./client.js";
const server = await startServer({ port: 0 });
try {
  const client = new VerifiableClient(server.mcpUrl);
  const discovery = await client.discover();
  const add = await client.callAndVerify("add", { a: 20, b: 22 }, "demo-sig-v1");
  console.log(`1. sync add: ${add.content[0].text} (verified demo-sig-v1)`);
  client.setCapabilities({ proofFormats: discovery.proofFormats }, true);
  const risk = await client.callAndVerify("riskScore", { symbol: "AAPL" }, "demo-commit-v1");
  console.log(`2. async riskScore: ${risk.content[0].text} (verified demo-commit-v1)`);
  client.setCapabilities({ proofFormats: discovery.proofFormats, blindExecution: true });
  const credit = await client.blindCall({ income: 100000, debt: 30000 });
  console.log(`3. blind privateCreditCheck: ${credit.content[0].text} (verified demo-sig-v1)`);
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : "demo failed");
  process.exitCode = 1;
} finally {
  await server.close();
}
