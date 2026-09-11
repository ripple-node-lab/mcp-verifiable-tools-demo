// TlsnPriceFeed retry/timeout behaviour — no sidecar needed; a local stub
// HTTP server plays the role of the sidecar's POST /attest.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import { TlsnPriceFeed } from "@demo/server";
import { attestationCommitment, jcs } from "@demo/protocol";

const attestationFor = (symbol: string) => {
  const data = jcs({ symbol, price: 123, currency: "USD" });
  return {
    type: "zktls-tlsn-v1",
    source: `https://test-server.io/v1/price/${symbol}`,
    commitment: attestationCommitment(data),
    data,
    proof: "AA",
    notaryKeyUri: "http://127.0.0.1:4400/notary-key"
  };
};

const urlOf = (server: Server): string => `http://127.0.0.1:${(server.address() as { port: number }).port}`;

// handler returns true if it wrote a response, false to leave the request hanging.
type Handler = (requestNumber: number, request: IncomingMessage, response: ServerResponse) => boolean;

async function withStub(handler: Handler, fn: (url: string, requests: { count: number }) => Promise<void>): Promise<void> {
  const requests = { count: 0 };
  const held: IncomingMessage[] = [];
  const server = createServer((request, response) => {
    requests.count++;
    if (!handler(requests.count, request, response)) held.push(request);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await fn(urlOf(server), requests);
  } finally {
    for (const request of held) request.destroy();
    server.close();
  }
}

const ok = (symbol: string): Handler => (_n, _request, response) => {
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(attestationFor(symbol)));
  return true;
};
const status = (code: number): Handler => (_n, _request, response) => {
  response.statusCode = code;
  response.end("error");
  return true;
};
const hang: Handler = () => false;

test("retries once when the first /attest attempt hangs, then resolves", async () => {
  await withStub((n, request, response) => (n === 1 ? hang(n, request, response) : ok("AAPL")(n, request, response)), async (url, requests) => {
    const feed = new TlsnPriceFeed({ baseUrl: url, timeoutMs: 200 });
    const attestation = await feed.fetch("AAPL");
    assert.equal(attestation.type, "zktls-tlsn-v1");
    assert.equal(attestation.data, attestationFor("AAPL").data);
    assert.equal(requests.count, 2);
  });
});

test("retries on 503 busy and resolves", async () => {
  await withStub((n, request, response) => (n === 1 ? status(503)(n, request, response) : ok("AAPL")(n, request, response)), async (url, requests) => {
    const feed = new TlsnPriceFeed({ baseUrl: url, timeoutMs: 200 });
    const attestation = await feed.fetch("AAPL");
    assert.equal(attestation.type, "zktls-tlsn-v1");
    assert.equal(requests.count, 2);
  });
});

test("does not retry on 4xx", async () => {
  await withStub(status(400), async (url, requests) => {
    const feed = new TlsnPriceFeed({ baseUrl: url, timeoutMs: 200 });
    try {
      await feed.fetch("AAPL");
      assert.ok(false, "expected rejection");
    } catch (error: unknown) {
      assert.ok(error instanceof Error && error.message === "tlsn /attest failed: 400");
    }
    assert.equal(requests.count, 1);
  });
});

test("gives up after `attempts` consecutive 5xx", async () => {
  await withStub(status(503), async (url, requests) => {
    const feed = new TlsnPriceFeed({ baseUrl: url, timeoutMs: 200, attempts: 2 });
    try {
      await feed.fetch("AAPL");
      assert.ok(false, "expected rejection");
    } catch (error: unknown) {
      assert.ok(error instanceof Error && error.message === "tlsn /attest failed: 503");
    }
    assert.equal(requests.count, 2);
  });
});
