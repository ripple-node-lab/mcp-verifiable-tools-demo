import test from "node:test";
import assert from "node:assert/strict";
import { createServer, Server as HttpServer } from "node:http";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod/v4";
import { VerifiableClient, TaskEnvelope } from "@demo/client";
import { DemoServer, DemoServerOptions } from "@demo/server";
import { EXTENSION_ID, TASKS_EXTENSION_ID, VerifiableToolsMeta } from "@demo/protocol";
import { attachVerifiableTools, assertServerSupportsVerifiableTools, createVerifiableClient, createVerifiableServer, sdkRpc, verifiableClientCapabilities } from "@demo/sdk-extension";
import { expectComplete } from "./helpers.js";

type Mode = "memory" | "http";

interface Rig {
  demo: DemoServer;
  sdkServer: Server;
  sdkClient: Client;
  client: VerifiableClient;
  close(): Promise<void>;
}

async function startRig(mode: Mode, options: DemoServerOptions = {}): Promise<Rig> {
  const demo = new DemoServer(options);
  await demo.listen(0); // /vk/* and /oracle-keys/* keep serving over demo.url
  const sdkServer = createVerifiableServer(demo);
  const sdkClient = new Client(
    { name: "sdk-test-client", version: "1.0.0" },
    { capabilities: verifiableClientCapabilities(["demo-sig-v1", "demo-commit-v1", "snarkjs-v2"], { blindExecution: true, tasks: true, requireInputProvenance: true }) }
  );
  let http: HttpServer | undefined;
  if (mode === "memory") {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await Promise.all([sdkServer.connect(serverSide), sdkClient.connect(clientSide)]);
  } else {
    // Stateful mode: stateless 1.30.0 rejects the post-initialize notification
    // POST with a 500; the client transport manages the session id itself.
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
    await sdkServer.connect(transport);
    http = createServer((request, response) => {
      void (async () => {
        const chunks: Uint8Array[] = [];
        for await (const chunk of request) chunks.push(chunk as Uint8Array);
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
        await transport.handleRequest(request as never, response as never, body);
      })().catch(() => { try { response.statusCode = 500; response.end(); } catch { /* closed */ } });
    });
    await new Promise<void>((resolve) => (http as HttpServer).listen(0, "127.0.0.1", resolve));
    const port = (http as HttpServer).address() as { port: number };
    await sdkClient.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port.port}/mcp`)));
  }
  const client = createVerifiableClient(sdkClient, demo.url);
  return {
    demo, sdkServer, sdkClient, client,
    async close() {
      await Promise.allSettled([sdkClient.close(), sdkServer.close(), demo.close()]);
      if (http) await new Promise<void>((resolve) => (http as HttpServer).close(() => resolve()));
    }
  };
}

for (const mode of ["memory", "http"] as Mode[]) {
  test(`[${mode}] initialize advertises the extension + tasks capability`, async () => {
    const rig = await startRig(mode);
    try {
      const capabilities = rig.sdkClient.getServerCapabilities();
      assert.ok(capabilities?.tools);
      const extension = capabilities?.extensions?.[EXTENSION_ID] as Record<string, unknown>;
      assert.ok(Array.isArray(extension.proofFormats));
      assert.ok(capabilities?.extensions?.[TASKS_EXTENSION_ID]);
    } finally { await rig.close(); }
  });

  test(`[${mode}] add verifies over SDK transport (demo-sig-v1, snarkjs-v2)`, async () => {
    const rig = await startRig(mode);
    try {
      for (const format of ["demo-sig-v1", "snarkjs-v2"]) {
        const result = await rig.client.callAndVerify("add", { a: 20, b: 22 }, format);
        assert.equal(result.content[0].text, "42");
      }
    } finally { await rig.close(); }
  });

  test(`[${mode}] riskScore runs through tasks/get polling and verifies`, async () => {
    const rig = await startRig(mode);
    try {
      rig.client.setCapabilities({ proofFormats: ["demo-commit-v1"], requireInputProvenance: true }, true);
      const call = await rig.client.callTool("riskScore", { symbol: "AAPL" }, { proofFormat: "demo-commit-v1" });
      assert.equal(call.result.resultType, "task");
      const result = await rig.client.poll(call.result as TaskEnvelope);
      const outcome = await rig.client.verify(result, { symbol: "AAPL" }, "riskScore", { nonce: call.nonce });
      assert.deepEqual(outcome, { ok: true });
    } finally { await rig.close(); }
  });

  test(`[${mode}] deferred priceQuote via verifiable-tools/prove`, async () => {
    const rig = await startRig(mode);
    try {
      const call = await rig.client.callTool("priceQuote", { symbol: "AAPL" }, { proofFormat: "demo-sig-v1" });
      const complete = expectComplete(call.result);
      const resultId = complete._meta?.[EXTENSION_ID]?.resultId;
      assert.equal(typeof resultId, "string");
      const proved = await rig.client.prove(resultId as string);
      const result = expectComplete(proved.result);
      const outcome = await rig.client.verify(result, { symbol: "AAPL" }, "priceQuote", { nonce: proved.nonce });
      assert.deepEqual(outcome, { ok: true });
    } finally { await rig.close(); }
  });

  test(`[${mode}] blind call verifies`, async () => {
    const rig = await startRig(mode);
    try {
      rig.client.setCapabilities({ proofFormats: ["demo-sig-v1"], blindExecution: true });
      const result = await rig.client.blindCall({ income: 100, debt: 20 });
      assert.ok(expectComplete(result).content[0].text.length > 0);
    } finally { await rig.close(); }
  });

  test(`[${mode}] riskScore provenance + feed failure maps to -32603`, async () => {
    const rig = await startRig(mode, { priceFeed: { fetch: () => Promise.reject(new Error("oracle down")) } });
    try {
      rig.client.setCapabilities({ proofFormats: ["demo-sig-v1"], requireInputProvenance: true });
      const failure = await rig.client.callTool("riskScore", { symbol: "AAPL" }).then(() => undefined, (error: unknown) => error);
      assert.equal((failure as Error).message, "input provenance unavailable");
    } finally { await rig.close(); }
    const healthy = await startRig(mode);
    try {
      healthy.client.setCapabilities({ proofFormats: ["demo-commit-v1"], requireInputProvenance: true });
      const call = await healthy.client.callTool("riskScore", { symbol: "AAPL" }, { proofFormat: "demo-commit-v1" });
      const result = call.result.resultType === "task" ? await healthy.client.poll(call.result as TaskEnvelope) : expectComplete(call.result);
      const meta = result._meta?.[EXTENSION_ID] as VerifiableToolsMeta;
      assert.equal(meta.inputAttestations?.[0]?.type, "oracle-sig-v1");
      const outcome = await healthy.client.verify(result, { symbol: "AAPL" }, "riskScore", { nonce: call.nonce });
      assert.deepEqual(outcome, { ok: true });
    } finally { await healthy.close(); }
  });

  test(`[${mode}] an SDK server without the extension fails the assert`, async () => {
    const plain = new Server({ name: "plain", version: "1.0.0" }, { capabilities: { tools: {} } });
    plain.setRequestHandler(z.looseObject({ method: z.literal("tools/list"), params: z.looseObject({}).optional() }), () => ({ tools: [] }));
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const sdkClient = new Client({ name: "c", version: "1.0.0" });
    await Promise.all([plain.connect(serverSide), sdkClient.connect(clientSide)]);
    try {
      assert.throws(() => assertServerSupportsVerifiableTools(sdkClient), /does not advertise/);
      assert.throws(() => createVerifiableClient(sdkClient, "http://127.0.0.1"), /does not advertise/);
    } finally { await Promise.allSettled([sdkClient.close(), plain.close()]); }
  });

  test(`[${mode}] tampered _meta proof fails verification`, async () => {
    const demo = new DemoServer();
    await demo.listen(0);
    const sdkServer = new Server({ name: "tamper", version: "1.0.0" }, { capabilities: { tools: {}, extensions: demo.discoveryExtensions as Record<string, object> } });
    sdkServer.setRequestHandler(z.looseObject({ method: z.literal("tools/call"), params: z.looseObject({}).optional() }), async (request) => {
      const response = await demo.dispatch({ jsonrpc: "2.0", id: (request.id as string | number | null | undefined) ?? null, method: "tools/call", params: request.params as never });
      if (response.error) throw new Error(response.error.message);
      const result = response.result as { _meta?: Record<string, unknown> };
      const meta = result._meta?.[EXTENSION_ID] as VerifiableToolsMeta;
      meta.proof = `0x${"00".repeat(32)}`;
      return result;
    });
    const sdkClient = new Client({ name: "c", version: "1.0.0" });
    let http: HttpServer | undefined;
    if (mode === "memory") {
      const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
      await Promise.all([sdkServer.connect(serverSide), sdkClient.connect(clientSide)]);
    } else {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
      await sdkServer.connect(transport);
      http = createServer((request, response) => {
        void (async () => {
          const chunks: Uint8Array[] = [];
          for await (const chunk of request) chunks.push(chunk as Uint8Array);
          await transport.handleRequest(request as never, response as never, chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined);
        })().catch(() => { try { response.statusCode = 500; response.end(); } catch { /* closed */ } });
      });
      await new Promise<void>((resolve) => (http as HttpServer).listen(0, "127.0.0.1", resolve));
      const port = ((http as HttpServer).address() as { port: number }).port;
      await sdkClient.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
    }
    try {
      const client = new VerifiableClient(demo.url, { rpc: sdkRpc(sdkClient) });
      const call = await client.callTool("add", { a: 1, b: 2 }, { proofFormat: "demo-sig-v1" });
      const outcome = await client.verify(expectComplete(call.result), { a: 1, b: 2 }, "add", { nonce: call.nonce });
      assert.notEqual(outcome.ok, true);
    } finally {
      await Promise.allSettled([sdkClient.close(), sdkServer.close(), demo.close()]);
      if (http) await new Promise<void>((resolve) => (http as HttpServer).close(() => resolve()));
    }
  });
}
