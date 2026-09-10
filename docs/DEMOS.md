# Running the demos

## Scenario demo (`npm run demo`)

`npm run demo` runs `packages/client/dist/src/main.js`, which is
self-contained: it starts a `DemoServer` in-process on a random port
(`startServer({ port: 0, … })` in `packages/client/src/main.ts`) and runs ten
scenarios against it. No separate server, port, or `DEMO_URL` is involved;
sidecar-backed scenarios are enabled purely by environment variables
(`RISC0_SIDECAR_URL`, `EZKL_SIDECAR_URL`, `TLSN_SIDECAR_URL`).

| # | Demonstrates | Proof format(s) | Prerequisites | Expected output line |
|---|---|---|---|---|
| 1 | synchronous `add`, verified | `demo-sig-v1` | none | `1. sync add: 42 (verified demo-sig-v1)` |
| 2 | async task: `riskScore` via `tasks/get` polling + input provenance | `demo-commit-v1` + `oracle-sig-v1` attestation | none | `2. async riskScore: … (verified demo-commit-v1, provenance oracle-sig-v1)` |
| 3 | blind committed-input call with HPKE-encrypted arguments and reply | `demo-sig-v1` | none | `3. blind privateCreditCheck: approved (verified demo-sig-v1)` |
| 4 | deferred proof: `priceQuote` → `verifiable-tools/prove` | `demo-sig-v1` | none | `4. deferred priceQuote: … (verified demo-sig-v1)` |
| 5 | TEE attestation format | `tee-nitro-v1` | none | `5. tee add: 3 (verified tee-nitro-v1)` |
| 6 | real Groth16 proof | `snarkjs-v2` | none | `6. zk add (snarkjs-v2 Groth16): 42 (verified, proof … bytes, …)` |
| 7 | real UltraHonk proof | `noir-v1` | none | `7. zk add (noir-v1 UltraHonk): 42 (verified, proof … bytes, …)` |
| 8 | zkVM receipt via sidecar | `risc0-v1` | `RISC0_SIDECAR_URL` (profile `risc0`) | `8. zk add (risc0-v1 sidecar): 42 (verified, proof … bytes, prove …, verify …)` |
| 9 | ZKML proof via sidecar | `ezkl-v1` | `EZKL_SIDECAR_URL` (profile `ezkl`) | `9. zk add (ezkl-v1 sidecar): 42 (verified, proof … bytes, prove …, verify …)` |
| 10 | zkTLS input provenance | `demo-commit-v1` + `zktls-tlsn-v1` attestation | `TLSN_SIDECAR_URL` (profile `tlsn`) | `10. zktls riskScore: … (verified demo-commit-v1, provenance zktls-tlsn-v1, presentation … bytes)` |

Actual output with no sidecars configured (timings vary; `bb.js` prints one
status line per proof):

```text
1. sync add: 42 (verified demo-sig-v1)
2. async riskScore: 72 (verified demo-commit-v1, provenance oracle-sig-v1)
3. blind privateCreditCheck: approved (verified demo-sig-v1)
4. deferred priceQuote: 604 (verified demo-sig-v1)
5. tee add: 3 (verified tee-nitro-v1)
6. zk add (snarkjs-v2 Groth16): 42 (verified, proof 719 bytes, prove 262.53 ms, verify 147.40 ms)
Generated proof for circuit with 3 public inputs and 458 fields.
7. zk add (noir-v1 UltraHonk): 42 (verified, proof 14656 bytes, prove 338.02 ms, verify 67.08 ms)
8. zk add (risc0-v1 sidecar): skipped (RISC0_SIDECAR_URL unset)
9. zk add (ezkl-v1 sidecar): skipped (EZKL_SIDECAR_URL unset)
10. zktls riskScore: skipped (TLSN_SIDECAR_URL unset)
```

With sidecars up (see below), scenarios 8–10 print their real lines. Typical
figures recorded in [BENCHMARKS.md](BENCHMARKS.md): `risc0-v1` proof ≈222 KB,
prove ≈19 s in docker (CPU); `ezkl-v1` proof ≈20 KB, prove ≈2–3 s;
`zktls-tlsn-v1` presentation ≈5.3 KB, attest ≈1 s.

## Raw HTTP walkthrough

Run `npm run server` (default `http://127.0.0.1:3939`; override with `PORT`).
All JSON-RPC goes to `POST /mcp`. The server enforces
(`packages/server/src/http.ts`): `Content-Type: application/json`,
`MCP-Protocol-Version: 2026-07-28` on every request, `Mcp-Method` equal to the
JSON-RPC `method`, and — for `tools/call` only — `Mcp-Name` equal to
`params.name`. Violations get `400` / `-32600 Invalid Request`. Request
bodies are capped at 1 MiB.

Recorded request/response examples live in `examples/`:

1. `server/discover` → [`examples/discover.json`](../examples/discover.json)
   (response: `capabilities.extensions` advertising `proofFormats`, the
   `hpke-v1` blind public key, `resultTtlMs`, and the tasks extension).
2. `tools/call` (`add` with a `demo-sig-v1` capability + nonce in `_meta`) →
   request [`examples/tools-call.request.json`](../examples/tools-call.request.json),
   complete result [`examples/tools-call.result.json`](../examples/tools-call.result.json)
   (`_meta["io.github.ripple-node-lab/verifiable-tools"]` carries `proof`,
   `proofFormat`, `circuitHash`, commitments, `nonce`, `publicInputs`,
   `verificationKeyUri`). ZK variants:
   [`tools-call.snarkjs-v2.response.json`](../examples/tools-call.snarkjs-v2.response.json),
   [`tools-call.noir-v1.response.json`](../examples/tools-call.noir-v1.response.json).
3. Async: when the client advertises `io.modelcontextprotocol/tasks`, a slow
   or ZK `tools/call` returns a task envelope —
   [`examples/tools-call.task.json`](../examples/tools-call.task.json)
   (`resultType: "task"`, `taskId`, `pollIntervalMs`) — which the client polls
   with `tasks/get`
   ([`examples/tasks-get.request.json`](../examples/tasks-get.request.json)).
4. Blind call: `verifiable-tools/call` carries `inputCommitment`,
   `encryptionScheme: "hpke-v1"`, `encryptedArguments`, and the requested
   `proofFormat` —
   [`examples/verifiable-tools-call.request.json`](../examples/verifiable-tools-call.request.json).

## Sidecars

`npm test` never needs sidecars. Each sidecar is a docker compose profile plus
an opt-in test gated on its `*_SIDECAR_URL` env var (the same commands CI
runs in `.github/workflows/ci.yml`):

| Sidecar | Profile | Port | Env var | Gated test |
|---|---|---|---|---|
| mock (`demo-sig-sidecar-v1`, `packages/sidecar-mock` via `sidecars/mock`) | `sidecar` | 4100 | `SIDECAR_URL` | `SIDECAR_URL=http://127.0.0.1:4100 npm run test:sidecar` |
| risc0 (`sidecars/risc0`) | `risc0` | 4200 | `RISC0_SIDECAR_URL` | `RISC0_SIDECAR_URL=http://127.0.0.1:4200 node --test tests/dist/risc0-sidecar.test.js` |
| ezkl (`sidecars/ezkl`) | `ezkl` | 4300 | `EZKL_SIDECAR_URL` | `EZKL_SIDECAR_URL=http://127.0.0.1:4300 node --test tests/dist/ezkl-sidecar.test.js` |
| tlsn (`sidecars/tlsn`) | `tlsn` | 4400 | `TLSN_SIDECAR_URL` | `TLSN_SIDECAR_URL=http://127.0.0.1:4400 node --test tests/dist/tlsn-sidecar.test.js` |

Each follows the same lifecycle:

```sh
docker compose --profile <profile> up --build -d --wait
npm run build          # tests run from tests/dist
<ENV>=<url> node --test tests/dist/<test>.test.js
docker compose --profile <profile> down
```

See [../sidecars/README.md](../sidecars/README.md) for the sidecar contract.

## SDK adapter demo

`packages/sdk-extension` adapts the extension onto the published
`@modelcontextprotocol/sdk@1.30.0` (the SDK owns transport + `initialize`;
`DemoServer.dispatch` keeps the semantics; `/vk/*` and `/oracle-keys/*` keep
serving from `DemoServer.listen`):

```ts
import { createVerifiableServer, createVerifiableClient, verifiableClientCapabilities } from "@demo/sdk-extension";

const demo = new DemoServer();
await demo.listen(3000);
const server = createVerifiableServer(demo);
await server.connect(/* any SDK transport */);

const capability = { proofFormats: ["demo-sig-v1"], requireInputProvenance: true, tasks: true };
const client = new Client({ name: "app", version: "1.0.0" }, {
  capabilities: verifiableClientCapabilities(capability)
});
await client.connect(/* peer transport */);
const verifiable = createVerifiableClient(client, demo.url, capability);
await verifiable.callAndVerify("add", { a: 20, b: 22 }, "demo-sig-v1");
```

Run its tests (in the default `npm test`, no docker):

```sh
npm run build && node --test tests/dist/sdk-extension.test.js
```

The suite runs the in-process scenarios that need no sidecar — `add`
(`demo-sig-v1`, `snarkjs-v2`), `riskScore` via `tasks/get` with `oracle-sig-v1`
provenance, deferred `priceQuote`, the blind call, and tamper/negotiation
failure cases — over both `InMemoryTransport` and stateful Streamable HTTP.
`noir-v1`, `tee-nitro-v1`, and the sidecar formats are covered only by the
raw-HTTP tests.

## Error codes you may see

JSON-RPC errors and client rejection reasons, from `packages/server`,
`packages/verifier/src/verifier.ts`, and
`packages/verifier/src/provenance.ts`:

- `-32600 Invalid Request` — malformed JSON-RPC, wrong/absent
  `MCP-Protocol-Version`, `Mcp-Method`/`Mcp-Name` mismatch, or body > 1 MiB.
- `-32602` — invalid arguments (e.g. `add` inputs out of the format's domain:
  `a, b, a+b ∈ [0, 2^32-1]` generally, `[0, 2^24]` for `ezkl-v1`; missing or
  non-string `symbol` for `riskScore`); `verifiable-tools/prove` also uses it
  with `data.reason` = `resultNotFound` (unknown `resultId`) or
  `resultExpired` (the `resultId` tombstone is retained for 2×TTL after
  expiry, then reports `resultNotFound`).
- `-32603` — internal failure; for `riskScore` a price-feed failure surfaces
  as `"input provenance unavailable"` when the client declared
  `requireInputProvenance`.
- Verification (`VerifyOutcome.reason`): `noProof`, `formatNotNegotiated`,
  `circuitHashMismatch`, `missingCommitment`, `inputCommitmentMismatch`,
  `outputCommitmentMismatch` (result content was altered after proving),
  `nonceMismatch` (replayed proof), `proofInvalid`.
- Provenance (`verifyProvenance`): `provenanceMissing` (required attestation
  absent), `provenanceMalformed`, `provenanceUnbound` (commitment not in
  `publicInputs`), `provenanceUnsupported` (no verifier for the attestation
  `type`), `provenanceInvalid` (artifact or commitment check failed).

## Appendix: rebuilding circuit artifacts

To rebuild the `snarkjs-v2` / `noir-v1` artifacts locally, install Circom
2.2.x, Nargo 1.0.0-beta.26, and the pinned npm dependencies, then run:

```sh
./scripts/build-circuits.sh
```

The script creates a local single-party Powers of Tau ceremony. Its output is
intentionally insecure and demo-only; `.ptau` files and intermediate zkeys are
ignored and are not committed. Run `npm run bench` to regenerate the
machine-specific measurements in [BENCHMARKS.md](BENCHMARKS.md).
bb.js 5.2.0 emits a proof-generation status line to stdout for each proof.
After changing a circuit, rebuild the artifacts first; the rebuild regenerates
the Noir verification-key document and updates the pinned hashes. Then run
`npm run build && npm test` to verify the generated artifacts and pins.
