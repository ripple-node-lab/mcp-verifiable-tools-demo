import { startServer } from "@demo/server";
import { VerifiableClient } from "./client.js";
import { EXTENSION_ID } from "@demo/protocol";
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
  const credit = await client.blindCall({ income: 100000, debt: 30000 }, { encryptReply: true });
  console.log(`3. blind privateCreditCheck: ${credit.content[0].text} (verified demo-sig-v1)`);
  const deferred = await client.callTool("priceQuote", { symbol: "AAPL" });
  if (deferred.result.resultType !== "complete") throw new Error("unexpected deferred task");
  const resultId = deferred.result._meta?.[EXTENSION_ID]?.resultId;
  if (!resultId) throw new Error("missing deferred resultId");
  const proved = await client.prove(resultId);
  if (proved.result.resultType !== "complete") throw new Error("unexpected deferred task");
  const verified = await client.verify(proved.result, { symbol: "AAPL" }, "priceQuote", { nonce: proved.nonce });
  if (!verified.ok) throw new Error(`deferred verification failed: ${verified.reason}`);
  console.log(`4. deferred priceQuote: ${proved.result.content[0].text} (verified ${proved.result._meta?.[EXTENSION_ID]?.proofFormat})`);
  const tee = await client.callAndVerify("add", { a: 1, b: 2 }, "tee-nitro-v1");
  console.log(`5. tee add: ${tee.content[0].text} (verified tee-nitro-v1)`);
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : "demo failed");
  process.exitCode = 1;
} finally {
  await server.close();
}
