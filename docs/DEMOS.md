# Running the demos

## Scenario demo (`npm run demo`)

`npm run demo` builds the packages (incremental `tsc -b`) and runs
`packages/client/dist/src/main.js`, which is
self-contained: it starts a `DemoServer` in-process on a random port
(`startServer({ port: 0, … })` in `packages/client/src/main.ts`) and runs ten
scenarios against it. No separate server, port, or `DEMO_URL` is involved;
sidecar-backed scenarios are enabled purely by environment variables
(`RISC0_SIDECAR_URL`, `EZKL_SIDECAR_URL`, `TLSN_SIDECAR_URL`). By default the
demo narrates each scenario (what is attempted, what the result means).

Environment variables:

- `DEMO_VERBOSE=0` — compact output only: headline/`checks:`/tamper/table lines.
- `DEMO_PAUSE=1` — step mode: waits for Enter before each scenario and before
  the tamper checks (interactive terminals only; ignored when stdin is not a TTY).
- `NO_COLOR` — disables ANSI colours (verified results green, skipped dim,
  `rejected` red, class column REAL green / DEMO yellow / MOCK magenta).
- `RISC0_SIDECAR_URL`, `EZKL_SIDECAR_URL`, `TLSN_SIDECAR_URL` — enable the
  sidecar scenarios 8–10 (see the table below).

| # | Demonstrates | Proof format(s) | Prerequisites | Expected output line |
|---|---|---|---|---|
| 1 | synchronous `add`, verified | `demo-sig-v1` | none | `1. sync add: 42 (verified demo-sig-v1)` |
| 2 | async task: `riskScore` via `tasks/get` polling + input provenance | `demo-commit-v1` + `oracle-sig-v1` attestation | none | `2. async riskScore: … (verified demo-commit-v1 · provenance oracle-sig-v1)` |
| 3 | blind committed-input call with HPKE-encrypted arguments and reply | `demo-sig-v1` | none | `3. blind privateCreditCheck: approved (verified demo-sig-v1)` |
| 4 | deferred proof: `priceQuote` → `verifiable-tools/prove` | `demo-sig-v1` | none | `4. deferred priceQuote: … (verified demo-sig-v1)` |
| 5 | TEE attestation format | `tee-nitro-v1` | none | `5. tee add: 3 (verified tee-nitro-v1)` |
| 6 | real Groth16 proof | `snarkjs-v2` | none | `6. zk add (snarkjs-v2 Groth16): 42 (verified snarkjs-v2 · proof … B · prove … ms · verify … ms)` |
| 7 | real UltraHonk proof | `noir-v1` | none | `7. zk add (noir-v1 UltraHonk): 42 (verified noir-v1 · proof … B · prove … ms · verify … ms)` |
| 8 | zkVM receipt via sidecar | `risc0-v1` | `RISC0_SIDECAR_URL` (profile `risc0`) | `8. zk add (risc0-v1 sidecar): 42 (verified risc0-v1 · proof … B · prove … ms · verify … ms)` |
| 9 | ZKML proof via sidecar | `ezkl-v1` | `EZKL_SIDECAR_URL` (profile `ezkl`) | `9. zk add (ezkl-v1 sidecar): 42 (verified ezkl-v1 · proof … B · prove … ms · verify … ms)` |
| 10 | zkTLS input provenance | `demo-commit-v1` + `zktls-tlsn-v1` attestation | `TLSN_SIDECAR_URL` (profile `tlsn`) | `10. zktls riskScore: … (verified demo-commit-v1 · provenance zktls-tlsn-v1 · presentation … B)` |

Actual output with no sidecars configured (verbose default; timings and
proof byte counts vary slightly between runs):

```text
── Setup ──
MCP verifiable-tools demo — server runs in-process as an UNTRUSTED operator; the client
verifies each result against keys/roots pinned locally by circuitHash (never fetched from the server).
Evidence travels in CallToolResult._meta["io.github.ripple-node-lab/verifiable-tools"]. Node v20.18.1; sidecars: none (scenarios 8-10 skipped)

   checks legend:
     circuitHash      identifies the circuit/key; the client looks up its PINNED verification key/root by this hash (never trusts one sent by the server)
     inputCommitment  H(salt || JCS(arguments)) recomputed by the client from the arguments it sent; must equal the value the proof binds
     outputCommitment H(JCS(content)) recomputed from the returned content; must equal the value the proof binds
     nonce            client-chosen fresh value echoed inside the proof (replay protection)
     proof            verified against the pinned key / verification key; REAL formats also prove the computation, DEMO formats only sign
     provenance       inputAttestations (oracle signature / TLSNotary) verified against pinned keys and bound into publicInputs

── Scenarios ──
1. sync add (demo-sig-v1)
   what:      sync tools/call for add(20,22) with proofFormat demo-sig-v1; client supplies a fresh nonce
   result:    42 (verified demo-sig-v1)
   checks:    circuitHash=0xe2d677e5… (pinned client-side) · inputCommitment=ok · outputCommitment=ok · nonce=ok · proof=ok (demo-sig-v1)
   evidence:  inputCommitment=0x19a9da21… outputCommitment=0x5f0cd650… nonce=0xe96c2377… proof=64 B
   means:     server signed (result, commitments, nonce) with a key pinned by circuitHash. demo-sig-v1 is a DEMO format: it proves origin and freshness, NOT that 20+22 was computed correctly.

2. async riskScore (demo-commit-v1)
   what:      riskScore(AAPL) runs as an MCP Task (tasks/get polling); result carries an oracle-sig-v1 attestation for the upstream price it used
   result:    72 (verified demo-commit-v1 · provenance oracle-sig-v1)
   checks:    circuitHash=0xfe9a89b0… (pinned client-side) · inputCommitment=ok · outputCommitment=ok · nonce=ok · proof=ok (demo-commit-v1) · provenance=ok (oracle-sig-v1)
   evidence:  inputCommitment=0x81c8d84d… outputCommitment=0x6061bcfd… nonce=0xf58af785… proof=32 B attestation=oracle-sig-v1
   means:     the attestation commitment is bound into publicInputs, so the proof covers WHICH input the server used, and the oracle key is pinned by URI. demo-commit-v1 is a DEMO format.

3. blind privateCreditCheck (demo-sig-v1)
   what:      privateCreditCheck(income, debt) via verifiable-tools/call: arguments HPKE-encrypted to the tool key, inputCommitment salted; reply encrypted back
   result:    approved (verified demo-sig-v1)
   checks:    circuitHash=0xf238b7ce… (pinned client-side) · inputCommitment=ok · outputCommitment=ok · nonce=ok · proof=ok (demo-sig-v1) · args=HPKE-encrypted (salted inputCommitment)
   evidence:  inputCommitment=0xa6f7a2d6… outputCommitment=0x87a98d30… nonce=0xbb938d90… proof=64 B ciphertext=4d79c0dc… (168 B)
   means:     server saw only inputCommitment + 168 bytes of HPKE ciphertext (no plaintext income/debt); the client verified the result against ITS salted commitment, so the result is for exactly the encrypted arguments. Confidentiality relies on the enclave/prover holding the tool key (demo: same process).

4. deferred priceQuote (demo-sig-v1)
   what:      priceQuote(AAPL) returns immediately with a resultId and no proof; client fetches the proof later with verifiable-tools/prove
   result:    604 (verified demo-sig-v1)
   checks:    circuitHash=0xe895ece8… (pinned client-side) · inputCommitment=ok · outputCommitment=ok · nonce=ok · proof=ok (demo-sig-v1) · via verifiable-tools/prove
   evidence:  inputCommitment=0x81c8d84d… outputCommitment=0xb5002304… nonce=0x677200ea… proof=64 B resultId=0f3ba9136a83f5604406ef192a00ce3d
   means:     proof generation is decoupled from the tool call; the deferred proof binds to the original result via resultId + commitments.

5. tee add (tee-nitro-v1)
   what:      add(1,2) with tee-nitro-v1: result comes with an AWS Nitro-style attestation document (COSE_Sign1, PCRs, userData)
   result:    3 (verified tee-nitro-v1)
   checks:    circuitHash=0xe2d677e5… (pinned client-side) · inputCommitment=ok · outputCommitment=ok · nonce=ok · proof=ok (tee-nitro-v1)
   evidence:  inputCommitment=0x43258cff… outputCommitment=0xdf3c1a60… nonce=0xad4c5eaf… proof=64 B teeAttestation=1356 B
   means:     client checked the attestation cert chain to the pinned root, pinned PCRs, nonce, and userData = hash of the tool's HPKE key; the enclave key certified there signed the commitments. MOCK attestation: root/PCR fixtures are generated locally, not from real Nitro hardware.

6. zk add (snarkjs-v2 Groth16)
   what:      add(20,22) with snarkjs-v2: REAL Groth16 proof (circom circuit), verified in-process with a pinned verification key
   result:    42 (verified snarkjs-v2 · proof 723 B · prove 259 ms · verify 157 ms)
   checks:    circuitHash=0xfb5e4566… (pinned client-side) · inputCommitment=ok · outputCommitment=ok · nonce=ok · proof=ok (snarkjs-v2)
   evidence:  inputCommitment=0x19a9da21… outputCommitment=0x5f0cd650… nonce=0xf3ee7de2… proof=723 B
   means:     the proof itself shows 20+22=42 was computed by the pinned circuit. Caveat: single-party trusted setup (demo ceremony).

7. zk add (noir-v1 UltraHonk)
   what:      add(20,22) with noir-v1: REAL UltraHonk proof (Noir circuit, bb.js), no trusted setup
   result:    42 (verified noir-v1 · proof 14656 B · prove 266 ms · verify 64 ms)
   checks:    circuitHash=0x70d3e406… (pinned client-side) · inputCommitment=ok · outputCommitment=ok · nonce=ok · proof=ok (noir-v1)
   evidence:  inputCommitment=0x19a9da21… outputCommitment=0x5f0cd650… nonce=0xf6a92e3a… proof=14656 B
   means:     same guarantee as 6 without a trusted setup; larger proof.

8. zk add (risc0-v1 sidecar)
   what:      add(20,22) proved in a Rust RISC Zero zkVM sidecar (receipt verified in-process via WASM)
   result:    skipped (RISC0_SIDECAR_URL unset)
   enable:    docker compose --profile risc0 up --build -d --wait && export RISC0_SIDECAR_URL=http://127.0.0.1:4200
   means:     if enabled: REAL zkVM receipt: any Rust program, no circuit authoring

9. zk add (ezkl-v1 sidecar)
   what:      add(20,22) proved by a Python ezkl ZKML sidecar (verified in-process via @ezkljs/engine)
   result:    skipped (EZKL_SIDECAR_URL unset)
   enable:    docker compose --profile ezkl up --build -d --wait && export EZKL_SIDECAR_URL=http://127.0.0.1:4300
   means:     if enabled: REAL ZKML proof over an ONNX model

10. zktls riskScore (demo-commit-v1)
   what:      riskScore(AAPL) with a TLSNotary presentation of the upstream HTTPS response as provenance (requireInputProvenance=true)
   result:    skipped (TLSN_SIDECAR_URL unset)
   enable:    docker compose --profile tlsn up --build -d --wait && export TLSN_SIDECAR_URL=http://127.0.0.1:4400
   means:     if enabled: REAL zkTLS provenance: the upstream response is proven to come from that TLS server, and is bound into publicInputs

── Tamper checks ──
   what:      each verified result is deep-copied client-side, ONE field is changed, and the same verify() runs again; every copy must be rejected
   output 42 -> 43 (#1):          rejected (outputCommitmentMismatch)  ← outputCommitment recomputed from content no longer matches
   nonce replaced (#1):           rejected (nonceMismatch)  ← echoed nonce differs from the one the client sent
   proof byte flipped (#1):       rejected (proofInvalid)  ← signature/proof fails against the pinned key
   provenance stripped (#2):      rejected (proofInvalid)  ← attestation commitment is bound into publicInputs, so the proof no longer verifies
   attestation doc flipped (#5):  rejected (proofInvalid)  ← COSE_Sign1 signature over the attestation document fails

── Summary ──
#   scenario                     result    format          class  provenance     tamper
1   sync add                     42        demo-sig-v1     DEMO   -              3/3 rejected
2   async riskScore              72        demo-commit-v1  DEMO   oracle-sig-v1  1/1 rejected
3   blind privateCreditCheck     approved  demo-sig-v1     DEMO   -              -
4   deferred priceQuote          604       demo-sig-v1     DEMO   -              -
5   tee add                      3         tee-nitro-v1    MOCK   -              1/1 rejected
6   zk add (snarkjs-v2 Groth16)  42        snarkjs-v2      REAL   -              -
7   zk add (noir-v1 UltraHonk)   42        noir-v1         REAL   -              -
8   zk add (risc0-v1 sidecar)    skipped   risc0-v1        REAL   -              -
9   zk add (ezkl-v1 sidecar)     skipped   ezkl-v1         REAL   -              -
10  zktls riskScore              skipped   demo-commit-v1  DEMO   -              -
   class: REAL = proof shows the computation itself was done correctly · DEMO = signature only (origin + freshness, not correctness) · MOCK = locally generated attestation fixtures, not real hardware
Summary: 7 verified (real ZK 2 · demo formats 4 · mock TEE 1), 3 skipped, 5/5 tampered results rejected
```

Reading the output:

| Line | Meaning |
|---|---|
| `N. <name> (<format>)` | Scenario title, printed before the call (verbose only; in compact mode the title and result share one headline `N. <name>: <result>`). |
| `what:` | What the scenario is about to attempt (verbose only). |
| `result:` | The result after the client verified it, or `skipped (<VAR> unset)`. |
| `checks:` | What `verifyResult` (`packages/verifier/src/verifier.ts`) confirmed, in order. A failure at any step is a `VerifyOutcome.reason` (`circuitHashMismatch`, `inputCommitmentMismatch`, `outputCommitmentMismatch`, `nonceMismatch`, `proofInvalid`, `provenance*`), aborts the demo, and the `checks:` line is never printed. `provenance=ok` appears only when the result carries an `inputAttestations` entry. |
| `evidence:` | The actual `_meta` values the proof binds — truncated commitments/nonce, proof byte size, plus per-scenario extras (`attestation`, `teeAttestation` size, HPKE `ciphertext` prefix, deferred `resultId`) (verbose only). |
| `means:` | What the verification actually guarantees, and whether the format is real or demo (verbose only). |
| `enable:` | For skipped scenarios, the compose command and env var that would enable it (verbose only). |
| `── <name> ──` | Section headers (Setup / Scenarios / Tamper checks / Summary), verbose only. |

Format classification in the summary: **real ZK** (`snarkjs-v2`, `noir-v1`,
`risc0-v1`, `ezkl-v1`) are genuine proofs — with the caveats that `snarkjs-v2`
uses a single-party demo trusted setup and the sidecars run on demo inputs;
**demo formats** (`demo-sig-v1`, `demo-commit-v1`) prove origin, freshness and
binding but NOT correct computation; **mock TEE** (`tee-nitro-v1`) exercises
the real attestation verification path against locally generated fixtures, not
Nitro hardware.

The summary table after the tamper section lists every scenario with its
result, proof format, class, provenance type, and how many tamper cases derived
from it were rejected; the final `Summary:` line totals verified/skipped and
rejected counts.

The Tamper section takes verified results, mutates one field at a time
client-side, re-verifies, and asserts the expected rejection reason — an
unexpected pass exits non-zero. Note that stripping `inputAttestations`
rejects with `proofInvalid` rather than `provenanceMissing`: the attestation
commit is bound into `publicInputs`, so the proof itself fails first.

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

Apple Silicon / arm64: the `risc0` image is x86_64-only and is pinned to
`platform: linux/amd64`, so Docker Desktop runs it under Rosetta/QEMU
emulation — build and proving are noticeably slower (the ≈20 s proof can take
several minutes). `ezkl` and `tlsn` build natively. If it is too slow, omit
`--profile risc0` and run 9–10 only.

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
- `-32000` with `data.reason` = `taskExpired` — a task exceeded its TTL while
  still working (`tasks/get` reports status `failed` with this `error`).
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
