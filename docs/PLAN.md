# Demo Plan

Target spec: [`docs/spec/verifiable-tools.md`](spec/verifiable-tools.md) (English / for SEP submission)
Related issue: https://github.com/zk-tokyo/advanced-cryptography-2026/issues/94
Rationale for technology choices: [#3 ZK / MPC / FHE library survey](https://github.com/ripple-node-lab/mcp-verifiable-tools-demo/issues/3), [#4 language-platform analysis](https://github.com/ripple-node-lab/mcp-verifiable-tools-demo/issues/4), [#6 technologies learned at ACP 2026](https://github.com/ripple-node-lab/mcp-verifiable-tools-demo/issues/6)
Out-of-plan extension candidates (suggestions derived from specific products/cases): [`docs/EXTENSIONS.md`](EXTENSIONS.md)

## 1. Goal

Following the MCP SEP guideline's "Prototype Requirements" and the design
principles "Demonstration over deliberation / Pragmatism over purity", let a
reviewer confirm with nothing more than `npm install && npm test` that the
`io.github.ripple-node-lab/verifiable-tools` extension **actually runs on MCP
2026-07-28**.

What the demo shows:

1. Capability advertisement via `server/discover` and per-request `_meta`
   extension negotiation
2. Proof metadata on `tools/call` results under
   `_meta["io.github.ripple-node-lab/verifiable-tools"]`, verifiable locally by
   the client
3. Asynchronous proof generation via the `io.modelcontextprotocol/tasks`
   extension (`resultType: "task"` → `tasks/get`)
4. Blind execution via `verifiable-tools/call` (encrypted arguments +
   `inputCommitment`)
5. The negative tests listed in the spec's Testing Plan (invalid proof,
   `circuitHash` mismatch, undeclared `proofFormat`, malformed blind input,
   ignoring the extension when it is not negotiated)

## 2. Design principles (Pragmatism over purity)

- **Make the protocol layer the star.** The essence of this extension is "how
  proofs are transported", not any specific ZK engine. Proving backends live
  behind `Prover` / `Verifier` interfaces and are swappable.
- **Phase 1 uses proof formats with zero dependencies.** ezkl / risc0 /
  snarkjs are heavy to set up and would violate "Be runnable by reviewers", so
  we first implement two formats verifiable with Node's built-in `crypto`.
  - `demo-sig-v1`: a simulation of "TEE attestation equivalent". The prover
    Ed25519-signs `circuitHash || inputCommitment || outputHash`; verification
    fetches the public key from `verificationKeyUri`.
  - `demo-commit-v1`: a simulation of "ZK proof equivalent".
    `publicInputs = [output, inputCommitment]`,
    `proof = SHA-256(circuitHash || publicInputs)`. No soundness as a proof,
    but it exercises the field flow (`publicInputs` / `circuitHash` /
    `verificationKeyUri`).
  - The README states clearly that **these are not cryptographic ZK**.
- **Phase 2-b (done) added real engines.** `snarkjs-v2` (Groth16, with a
  pre-compiled small Circom circuit's `wasm` / `zkey` / `vk.json` bundled) and
  Noir (UltraHonk) are implemented as real ZK backends that run on npm alone.
  `ezkl-v1` / `risc0-v1` / TEE / zkTLS are composed as sidecars in Phase 3
  (§5).
- **Avoid SDK dependency.** So we are not hostage to the official SDK's
  2026-07-28 support status, JSON-RPC 2.0 + Streamable HTTP (POST only) is
  implemented thinly in-house. Protocol handling is isolated in
  `packages/protocol` so it can later be ported onto `typescript-sdk`'s
  Extension API.
- **Language policy (the #4 conclusion): the protocol layer and the
  client-verification layer are TypeScript; proving backends are composed in
  the best language for each engine via adapters.** The decision axis is the
  same as "the essence is how proofs are transported" above, and the language
  boundary sits at the same place.
  - `packages/protocol` / `server` / `client` / `verifier` stay TS. MCP's
    canonical schemas and the Phase 4 port target (`typescript-sdk`) are TS,
    and verifiers must be distributable to IDEs / agent hosts (mostly TS) via
    npm / WASM.
  - `Prover` / `Verifier` implementations split into two adapter kinds:
    **in-process** (TS / WASM: `snarkjs`, Noir `@noir-lang/noir_js` +
    `@aztec/bb.js`, `@ezkljs/engine` verification, `hpke-js`) and **sidecar**
    (Rust / Python / enclave in Docker, invoked over CLI / HTTP: risc0 host,
    ezkl prover, Nitro enclave, TLSNotary prover). The engine's language is
    hidden behind the adapter.
  - `npm test` always passes with in-process formats only. Sidecar formats are
    opt-in via `docker compose --profile sidecar` and run in separate CI jobs
    (guarding "Be runnable by reviewers").
  - Directions not taken: wholesale migration to Rust / Go / Python (worsens
    reviewer reproducibility and Phase 4 port cost), pushing every engine into
    in-process WASM (risc0 / ezkl provers are not practically fast in WASM;
    WASM builds are limited to verifiers).
- **Pin in the spec not just "correct computation" but "what the proof is
  bound to".** The spec revision (§2.1 below) introduced `outputCommitment` /
  `nonce` / `tools/list` descriptors / `inputAttestations` / deferred proofs.
  The demo implements these at the start of Phase 2, with negative tests
  showing that "a real proof + different output", "replayed proof", and
  "brute-forcing an unsalted commitment" are all rejected.

### 2.1 Key points and rationale of the spec revision (2026-09)

Based on the #94 comments (cost assumed borne by the server; per-call vs. spot
verification depends on the use case; zkTLS / FHE as extensions; evaluation
axes = proving time / size / compute cost) and the #3 / #4 / #6 research, the
following was added to the spec.

| Addition | What it solves | Discussion it is based on |
|---|---|---|
| Motivation "the trust gap authorization cannot fill" + use cases A–F | Articulates the difference between "who can access" and "whether the returned value is correct" via four conditions (third-party servers, supply-chain compromise, irreversible actions, after-the-fact accountability), concretized in six scenarios: A2A tool marketplaces / trading / private data under regulation / authenticated model inference / multi-hop agents / autonomous security response (Proof-of-Exploit) | #94 summary, #6 Week 1 (PoE × Circuit-Breaker), Week 2 (ZK/FHE/MPC/TEE comparison) |
| "What is / is not guaranteed" table | Explicitly puts input authenticity, function validity, and availability out of scope (prevents over-trust born of misunderstanding) | #6 Week 2 (MPC does not guarantee input correctness → compensate with ZK / commitments), Week 5 (FHE alone does not guarantee correctness) |
| `outputCommitment` / `nonce` / Result binding section | Blocks attaching a real proof to different `content`, and replaying stale proofs. Fixes the `publicInputs[0..2]` ordering to raise cross-engine interoperability | Spec Open Question "standard `publicInputs` encoding", Phase 1 implementation review |
| Salted `inputCommitment` (JCS RFC 8785) | The previous demo's `SHA-256(canonical JSON(args))` was not hiding: low-entropy arguments (account numbers, yes/no flags) could be recovered by brute force. In blind calls the salt is included in the encrypted payload | Phase 1 implementation review, #6 Week 3 (commitment schemes) |
| `tools/list` `_meta` descriptors (`circuitHash`, `proofPolicy`, …) | Defines how a client obtains tool → `circuitHash` (resolves a §7 open question). Descriptors remain hints, pinned via TOFU / out-of-band registries | §7 open question |
| `inputAttestations` (`zktls-tlsn-v1`, `oracle-sig-v1`, `mcp-verifiable-v1`) | Covers "reliance on data providers": zkTLS attests an external API's output, a nested MCP result attests an upstream server's proof — each appended to the main proof's public inputs | #94 comment "reliance on data providers: zkTLS", #3 §2 (mpz = TLSNotary foundation) |
| Deferred proofs (`resultId`, `verifiable-tools/prove`, `proofPolicy: always / onDemand / sampled`, `resultTtlMs`) | Lets "verify by spot-check rather than per-call" and "who bears proving cost" be chosen per tool rather than fixed in the protocol | #94 comments 3–4 |
| Fixed `encryptionScheme` (`hpke-v1` = RFC 9180 DHKEM(X25519)+HKDF-SHA256+AES-128-GCM, `fhe-tfhe-v1` reserved), attestation binding of `blindPublicKeys`, output-side leakage and `replyPublicKey` | Moves from the previous `x25519-aesgcm-demo-v1` to standard HPKE. FHE is reserved-only ("confidentiality is achievable, but correctness cannot be proven without vFHE") | #3 §3 (node-seal / TFHE-rs), #4 §4-5 (`hpke-js`), #6 Week 5 (PBS, vFHE), Week 2 (output leakage) |
| Verification procedure for TEE attestation formats (chain / measurement / key binding into user-data / freshness) | Turns `teeAttestation` from an "opaque string" into a verifiable contract | #4 §2 (Nitro is verifiable in TS, SGX DCAP is a sidecar) |
| Rationale trade-off table, Performance measurement requirement | Makes each format definition report proving time, size, verification time, and verifier dependency footprint | #94 comment "proving time, proof size, compute speed, compute cost, trade-offs" |
| Security: replay / output substitution / hiding / provenance / descriptor trust / randomness reuse / revocation | Maps 1-to-1 to the negative tests (§4.3) | #6 Week 2 (Beaver triple reuse), Week 3 (key recovery via nonce reuse) |

## 3. Repository layout

```text
mcp-verifiable-tools-demo/
├── README.md                     # setup, extension identifiers, supported proofFormats, disclaimer
├── docs/
│   ├── PLAN.md                   # this document
│   └── spec/
│       └── verifiable-tools.md      # SEP draft (English)
├── package.json                  # npm workspaces
├── tsconfig.base.json
├── packages/
│   ├── protocol/                 # extension types / constants / _meta helpers (SDK-independent)
│   │   └── src/
│   │       ├── constants.ts      # EXTENSION_ID, TASKS_EXTENSION_ID, PROTOCOL_VERSION, META keys
│   │       ├── types.ts          # VerifiableToolsCapability, VerifiableToolsMeta, VerifiableCallParams ...
│   │       ├── meta.ts           # clientCapabilities construction / extraction, negotiation (proofFormats intersection)
│   │       ├── cbor.ts           # CBOR (RFC 8949) encode / decode (Phase 3-a)
│   │       ├── cose.ts           # COSE_Sign1 (RFC 9052) encode / decode (Phase 3-a)
│   │       └── index.ts
│   ├── prover/                   # proof backends (server side)
│   │   └── src/
│   │       ├── prover.ts         # interface Prover { format; prove(input) }
│   │       ├── demo-sig.ts       # demo-sig-v1 (Ed25519)
│   │       ├── demo-commit.ts    # demo-commit-v1 (SHA-256)
│   │       ├── tee-nitro.ts      # tee-nitro-v1 (produces a COSE_Sign1 attestation, mock fixtures; Phase 3-a)
│   │       └── index.ts
│   ├── verifier/                 # proof verification (client side)
│   │   └── src/
│   │       ├── verifier.ts       # interface Verifier { format; verify(meta, ctx) }
│   │       ├── demo-sig.ts
│   │       ├── demo-commit.ts
│   │       ├── registry.ts       # verificationKeyUri → public-key fetch + per-circuitHash pinning
│   │       ├── tee-nitro.ts      # tee-nitro-v1 verification (chain / PCR / user_data / nonce / freshness; Phase 3-a)
│   │       └── index.ts
│   ├── server/                   # MCP 2026-07-28 Streamable HTTP server
│   │   └── src/
│   │       ├── http.ts           # POST /mcp, MCP-Protocol-Version / Mcp-Method / Mcp-Name checks
│   │       ├── discover.ts       # server/discover
│   │       ├── tools.ts          # tools/list, tools/call (sync / task)
│   │       ├── tasks.ts          # tasks/get, tasks/cancel (in-memory task store)
│   │       ├── blind.ts          # verifiable-tools/call (decrypt → execute → prove)
│   │       ├── tools/
│   │       │   ├── add.ts        # add(a, b): synchronous proof
│   │       │   ├── riskScore.ts  # riskScore(symbol): delayed asynchronous proof (tasks)
│   │       │   └── creditCheck.ts# privateCreditCheck: blind-only
│   │       └── main.ts           # `npm run server`
│   ├── prover-snarkjs/           # snarkjs-v2 (Circom/Groth16; Phase 2-b)
│   ├── prover-noir/              # noir-v1 (Noir/UltraHonk; Phase 2-b)
│   ├── prover-risc0/             # risc0-v1 WASM verifier (Phase 3-b)
│   ├── prover-ezkl/              # ezkl-v1 engine verifier + add circuit artifacts (Phase 3-c)
│   ├── prover-sidecar/           # sidecar HTTP contract adapter (Phase 3-a)
│   │   └── src/
│   │       ├── contract.ts       # GET /healthz, POST /prove, POST /verify, GET /vk/{circuitHash}
│   │       ├── prover.ts         # SidecarProver (enforces echo checks on binding fields)
│   │       ├── verifier.ts       # SidecarVerifier
│   │       └── health.ts
│   ├── sdk-extension/            # adapter onto @modelcontextprotocol/sdk 1.30.0 (Phase 4-a)
│   ├── sidecar-mock/             # contract reference implementation (demo-sig-sidecar-v1, node:http; Phase 3-a)
│   └── client/                   # verifying client
│       └── src/
│           ├── client.ts         # discover → capability intersection → tools/call → verify
│           ├── tasks.ts          # tasks/get polling per pollIntervalMs
│           ├── blind.ts          # argument encryption + inputCommitment → verifiable-tools/call
│           └── main.ts           # `npm run demo` runs the 10 scenarios in order
├── examples/                     # the same JSON messages as the spec (also used as test fixtures)
│   ├── discover.json
│   ├── tools-call.request.json
│   ├── tools-call.result.json
│   ├── tools-call.task.json
│   ├── tasks-get.request.json
│   └── verifiable-tools-call.request.json
├── sidecars/                     # sidecar fleet (Phase 3-a)
│   ├── README.md                 # HTTP contract and startup instructions
│   ├── mock/Dockerfile           # container for sidecar-mock
│   ├── nitro/                    # gen-mock-fixtures.sh + mock-fixtures/ (mock root CA / PCR / keys)
│   ├── risc0/                    # Rust sidecar (guest: u32 add, host: tiny_http HTTP contract) + wasm-verify + fixtures/ + image-id.txt (Phase 3-b)
│   ├── ezkl/                     # Python sidecar (stdlib HTTP contract) + fixtures/ (Phase 3-c)
│   └── tlsn/                     # Rust sidecar (axum HTTP: /attest /verify /notary-key + loopback fixture + in-process notary; Phase 3-d)
├── docker-compose.yml            # `docker compose --profile sidecar` (opt-in)
├── tests/                        # node:test (integration tests)
│   ├── negotiation.test.ts
│   ├── sync-proof.test.ts
│   ├── async-tasks.test.ts
│   ├── blind-call.test.ts
│   ├── negative.test.ts
│   ├── cbor.test.ts              # Phase 3-a
│   ├── tee-nitro.test.ts         # Phase 3-a
│   ├── sidecar.test.ts           # Phase 3-a (also checks an external sidecar when SIDECAR_URL is set)
│   ├── risc0.test.ts             # Phase 3-b (verifies the committed receipt fixture in WASM)
│   ├── risc0-sidecar.test.ts     # Phase 3-b (only when RISC0_SIDECAR_URL is set)
│   ├── ezkl.test.ts              # Phase 3-c (verifies the committed proof fixture with the engine)
│   ├── ezkl-sidecar.test.ts      # Phase 3-c (only when EZKL_SIDECAR_URL is set)
│   ├── provenance.test.ts        # Phase 3-d (inputAttestations / requireInputProvenance)
│   ├── tlsn-sidecar.test.ts      # Phase 3-d (only when TLSN_SIDECAR_URL is set)
│   └── sdk-extension.test.ts     # Phase 4-a (InMemory + Streamable HTTP transports)
└── .github/workflows/ci.yml      # npm ci && npm run build && npm test + sidecar opt-in jobs
```

## 4. Component specifications

### 4.1 Server (`packages/server`)

- `POST /mcp` only. `Content-Type: application/json`.
- Required header checks: `MCP-Protocol-Version: 2026-07-28`, `Mcp-Method`
  matching the JSON-RPC `method`, and for `tools/call` `Mcp-Name` matching
  `params.name`. Mismatches get JSON-RPC `-32600 Invalid Request`.
- Reads the extension declaration from each request's
  `params._meta["io.modelcontextprotocol/clientCapabilities"]` (stateless; no
  session IDs).
- The `server/discover` response has the same shape as the example in spec §5
  (`proofFormats: ["demo-sig-v1", "demo-commit-v1"]`, `blindExecution: true`,
  `io.modelcontextprotocol/tasks: {}`).
- `tools/call`:
  - If the client has not declared the extension, return **a plain
    `CallToolResult` only** (no extension key in `_meta`).
  - If declared, pick one format from the `proofFormats` intersection
    (`_meta["io.github.ripple-node-lab/verifiable-tools"].requestedProofFormat`
    takes priority). If the intersection is empty and `requireProof: true`,
    return a `-32602`-equivalent error; otherwise return the result unproven.
  - `riskScore` returns `resultType: "task"` only when the client has declared
    `io.modelcontextprotocol/tasks` (otherwise it blocks and returns
    synchronously).
- `tasks/get` / `tasks/cancel`: the SEP-2663 `Task` shape (`taskId`, `status`,
  `createdAt`, `lastUpdatedAt`, `ttlMs`, `pollIntervalMs`). On completion
  `result` carries the `CallToolResult` + extension `_meta`.
- `verifiable-tools/call`: implements `hpke-v1`, salted 32-byte JCS
  `inputCommitment`, nonce binding, and encrypted replies via `replyPublicKey`.
  The server advertises `blindPublicKeys["hpke-v1"]` and `resultTtlMs` in
  discovery.
- `GET /vk/{circuitHash}`: the entity behind `verificationKeyUri`. Returns the
  `demo-sig-v1` Ed25519 public key (PEM).

### 4.2 Client (`packages/client`)

1. `server/discover` and `tools/list` → verify capabilities and descriptors
   (`circuitHash` / `formats`).
2. `tools/call add` → nonce-bound output/input commitments → verify the
   negotiated proof.
3. `tools/call riskScore` → `resultType: "task"` → `tasks/get`; `tasks/cancel`
   wires into `AbortSignal`.
4. `priceQuote` → `resultId` → fetch an on-demand proof via
   `verifiable-tools/prove` and verify within `resultTtlMs`.
5. `verifiable-tools/call privateCreditCheck` → salted `hpke-v1` argument
   encryption, optional `replyPublicKey`, verify the proof after decrypting.
6. On verification failure the result is not used and the process exits
   non-zero (spec: "A client MUST NOT act on a tool result whose proof fails
   verification").

### 4.3 Tests (`tests/`, `node --test`)

| File | What it checks |
|---|---|
| `negotiation.test.ts` | extension not declared → no extension key in `_meta` / declared → present / empty intersection + `requireProof` → error |
| `sync-proof.test.ts` | `add` proof verifies in both formats; `publicInputs[0]` matches `content[0].text` |
| `async-tasks.test.ts` | tasks not declared → synchronous completion / declared → `resultType: "task"` → polls to completion and verifies |
| `blind-call.test.ts` | happy path, accepted without `Mcp-Name`, plaintext never appears in server logs |
| `negative.test.ts` | tampered `proof`, `circuitHash` mismatch, undeclared `proofFormat`, `inputCommitment` mismatch, `Mcp-Method` mismatch |
| `binding.test.ts` (Phase 2-a) | real proof + tampered `content` → rejected on `outputCommitment` mismatch / replayed old proof → rejected on `nonce` mismatch / unsalted or wrong-salt blind commitments → rejected |
| `descriptor.test.ts` (Phase 2-a) | `tools/list` `circuitHash` differing from the pinned value → surfaced as an error, not silently accepted |
| `deferred-proof.test.ts` (Phase 2-a) | a `proofPolicy: onDemand` tool → only `resultId` returned → `verifiable-tools/prove` returns byte-identical `content` whose proof verifies / after `resultTtlMs` → `resultExpired` |
| `provenance.test.ts` (Phase 3-d, in default suite) | `requireInputProvenance` + `externalInputs` oracle-sig-v1 happy path; negatives `provenanceMissing` / `provenanceMalformed` / `provenanceUnbound` / `provenanceUnsupported` / `provenanceInvalid` (tampered data, forged oracle signature); commitment binding into the main proof; feed failure → -32603 |
| `tlsn-sidecar.test.ts` (Phase 3-d, opt-in) | only with `TLSN_SIDECAR_URL`: `/healthz` & `/notary-key` (secp256k1 SPKI PEM), DemoServer→client end-to-end zktls path, tampered data → `provenanceInvalid`, wrong notary key → `ok:false`, non-fixture source → 400 |
| `sdk-extension.test.ts` (Phase 4-a, in default suite) | over both InMemory + Streamable HTTP transports: initialize capability advertisement, demo-sig/snarkjs verification, tasks polling, deferred proof, blind call, provenance (happy path + feed failure -32603), rejection of an extension-less server, tampered-proof rejection |
| `randomness.test.ts` (Phase 2-b) | snarkjs / Noir produce different proofs for identical inputs and both verify |
| `cbor.test.ts` (Phase 3-a) | RFC 8949 Appendix A vector decode / canonical encode; rejects indefinite-length, trailing, and truncated inputs |
| `tee-nitro.test.ts` (Phase 3-a) | `tee-nitro-v1` happy path (attestation verification, `verificationKeyUri` not emitted, tools/list descriptor) + `verifyDetailed` negatives (measurement / chain / user_data / nonce / freshness / proof signature / malformed) + `teeNitro: false` → not advertised, requireProof error |
| `sidecar.test.ts` (Phase 3-a) | mock sidecar (`demo-sig-sidecar-v1`) prove / verify round trip; a sidecar that alters binding fields or is down yields a JSON-RPC error and no result; AbortSignal; `sidecarHealth`; external-sidecar smoke test when `SIDECAR_URL` is set |
| `risc0.test.ts` (Phase 3-a–b, in default suite) | in-process WASM verification of a real composite receipt fixture + negatives (tampered receipt / wrong circuitHash / publicInputs mismatch / dev-mode Fake rejection) |
| `risc0-sidecar.test.ts` (Phase 3-b, opt-in) | only with `RISC0_SIDECAR_URL`: `/healthz` imageId matches the pin, DemoServer→client end-to-end, `/verify` response, `/prove` circuitHashMismatch → 400 |
| `ezkl.test.ts` (Phase 3-c, in default suite) | in-process `@ezkljs/engine` verification of a real proof fixture + negatives (tampered proof / instances / wrong circuitHash / publicInputs mismatch / AbortError) |
| `ezkl-sidecar.test.ts` (Phase 3-c, opt-in) | only with `EZKL_SIDECAR_URL`: `/healthz` circuitHash matches the pin, DemoServer→client end-to-end, `/verify` response, `/prove` circuitHashMismatch → 400 |

## 5. Implementation phases

| Phase | Contents | Deliverables |
|---|---|---|
| 1 (done) | Skeleton of the layout above + `demo-sig-v1` / `demo-commit-v1` + 3 scenarios + tests + CI | `npm run demo` / `npm test` pass |
| 2-a (done) | Implemented `outputCommitment` / `nonce` / salted JCS commitments / `tools/list` descriptors / `formats` overrides / `priceQuote` on-demand proofs + `verifiable-tools/prove` / `resultTtlMs` / abortable `tasks/cancel` / `replyPublicKey` / RFC 9180 base-mode `hpke-v1` in protocol, server, and client, plus binding / deferred / descriptor / HPKE negative tests | With the same two formats, the revised spec's Phase 2-a fields are verified by `npm test` |
| 2-b real ZK (done) | Implemented `snarkjs-v2` (Groth16, pre-compiled circom `add` circuit with bundled `wasm` / `zkey` / `vk.json`; the local single-party trusted setup is demo-only) and Noir (`@noir-lang/noir_js` + `@aztec/bb.js`, UltraHonk, no trusted setup) in separate workspaces (`packages/prover-snarkjs`, `packages/prover-noir`), included in default `npm test` | Two real ZK proof formats; measured figures in [`docs/BENCHMARKS.md`](BENCHMARKS.md) |
| 3-a (done) sidecar foundation + `tee-nitro-v1` | sidecar HTTP contract (`/healthz` / `/prove` / `/verify` / `/vk/{circuitHash}`) + `packages/prover-sidecar` adapter (echo checks on binding fields) + `packages/sidecar-mock` (`demo-sig-sidecar-v1`) + `docker compose --profile sidecar` / CI opt-in job. For `tee-nitro-v1`, COSE_Sign1 / CBOR codecs were implemented in protocol and chain / PCR measurement / user_data key binding / nonce / freshness verification in TS. Attestations are issued with the mock root CA / mock PCRs in `sidecars/nitro/mock-fixtures` (not the AWS Nitro root) | sidecar formats run opt-in; `teeAttestation` becomes a verifiable contract |
| 3-b (done) `risc0-v1` | `sidecars/risc0` (Rust workspace, `risc0-zkvm`/`risc0-build` 3.0.6 pinned, `tiny_http` HTTP contract, guest = u32 `checked_add` → 12B LE journal) + `packages/prover-risc0` (verification in-process via a wasm32 build of `risc0-zkvm`, ≈1.5 MB, verifies a real receipt in ≈40–60 ms) + `docker compose --profile risc0` / CI opt-in job. Measured: composite prove ≈19 s (docker, CPU) / ≈40–50 s (bare metal), receipt ≈222 KB, dev-mode receipt ≈88 ms / 825 B. Groth16 compression (→≈0.2 KB) not done — needs GPU / the `risczero/risc0-groth16-prover` docker. Remaining: in-flight prove cancellation unsupported (`SidecarProver`'s abort only closes HTTP; the r0vm job runs to completion and holds a `MAX_CONCURRENT_PROOFS` slot) | zkVM receipt proofs run via sidecar; verification stays in TS via WASM |
| 3-c (done) `ezkl-v1` | `sidecars/ezkl` (`python:3.12-slim` + `ezkl==22.0.1` pinned, stdlib `http.server`, `add` circuit = single ONNX `Add` + scale 0 for exact integers / logrows=14, SRS = committed perpetual powers-of-tau 2.1 MB, pk 117 MB regenerated at startup by `ezkl.setup` + vk sha256 cross-check) + `packages/prover-ezkl` (in-process verification with `@ezkljs/engine` 22.0.1 wasm ≈9.8 MB) + `docker compose --profile ezkl` / CI opt-in job. Measured: prove ≈2–3 s, proof ≈20 KB, vk 34 KB, engine verify ≈240 ms. Constraints: exact version match required (engine is 22.0.1 only; 22.3+/23.x artifacts cannot be verified), engine supports logrows ≥14 only, `get_srs` is broken in 22.0.1 so the committed-SRS approach is used, `gen_srs` output fails engine verification, input domain is `a, b ∈ [0, 2^24]` — ONNX FLOAT inputs are exact only below 2^24 (2^24+1 rounds to 2^24) and the range-check decomposition (base 16384, n=2) caps at 2^28. Remaining: in-flight prove cancellation unsupported | ZKML proofs run via sidecar |
| 3-d (done) input provenance | `packages/protocol` (`InputAttestation` / `parseInputAttestation` / `attestationCommitment` / `ToolDescriptorMeta.externalInputs` / `requireInputProvenance` on `clientCapabilities`) + proof binding (`ProveInput.inputAttestations` → commitments appended to the `publicInputs` tail, reflected in the signed/checked material of demo-sig / demo-commit / tee-nitro / sidecar-mock) + `packages/verifier/src/provenance.ts` (`ProvenanceVerifier` / `verifyProvenance` / `OracleSigVerifier`, five `provenance*` reasons) + `packages/server/src/pricefeed.ts` (`OraclePriceFeed`: ed25519 + `/oracle-keys/demo` PEM; `TlsnPriceFeed`: sidecar `/attest`) + `sidecars/tlsn` (single Rust binary: loopback HTTPS fixture `test-server.io` + in-process notary + axum API, tlsn `v0.1.0-alpha.15` git pin) + `docker compose --profile tlsn` / CI opt-in job. `riskScore` became `riskScore(symbol, price)` and consumes the attested price. Measured: attest ≈1 s (MPC-TLS setup ≈670 ms + request ≈93 ms + notarize ≈118 ms), presentation bincode ≈5.3 KB, notary key = secp256k1 (33 B SEC1), verify ≈0.2 ms. Remaining: in-process TS verification impossible (`tlsn-core` needs `getrandom` on bare wasm32) — delegated to sidecar `/verify`, notary key pinned via the origin-allowlisted registry; the fixture server stands in for a real exchange API; the `data` field is a demo extension of the spec; `priceQuote` carries no attestation | `requireInputProvenance` negative tests pass and the zkTLS path runs via sidecar |
| 4-a (done) SDK bridge | `packages/sdk-extension`: a thin adapter placing the extension on the published `@modelcontextprotocol/sdk@1.30.0` pin (+ zod 4.5.4) `Server` / `Client`. Server side: `attachVerifiableTools` calls `registerCapabilities({ tools, extensions })` (putting the same capability as `server/discover` — `DemoServer.discoveryExtensions` — into the initialize result) + delegates each method via `setRequestHandler` (loose zod schemas) to `DemoServer.dispatch`. `tasks/get` / `tasks/cancel` go through `fallbackRequestHandler` because SDK 1.30 requires `capabilities.tasks` (the SDK-specific tasks shape) at registration. Client side: `sdkRpc` / `createVerifiableClient` / `assertServerSupportsVerifiableTools` (fails if initialize's `capabilities.extensions` lacks the extension) + the `VerifiableClientOptions.rpc` seam. `tests/sdk-extension.test.ts` verifies 16 cases over both InMemory + Streamable HTTP transports. Known differences: SDK negotiates 2025-11-25 at initialize (1.x predates the unpublished 2026-07-28; the extension still sends `io.modelcontextprotocol/protocolVersion` in `_meta`), `Mcp-Method` / `Mcp-Name` headers are not enforced on the SDK transport (stateless mode has a known 1.30.0 issue dropping the post-initialize notification with 500 — tests use stateful sessions), tasks pass as extension custom methods rather than SDK experimental tasks. A Python SDK version is positioned as the second server-side reference implementation for `ezkl-v1` (#4 §4-4) | All scenarios (proof / tasks / deferred / blind / provenance) verifiable over the SDK |
| 4-b SDK v2 migration (not started) | Once `typescript-sdk` v2 (2026-07-28 wire, proper `server/discover` API, formal `extensions` capability support) is published, raise initialize's protocolVersion to 2026-07-28 and move `server/discover` onto the SDK-native implementation | SDK fork/branch |
| Future work (optional) | `fhe-tfhe-v1` (client-side encryption with `node-seal` or TFHE-rs WASM → server-side homomorphic evaluation; confidentiality-only demo since correctness awaits vFHE), MPC / co-SNARK prover (proving over inputs secret-shared across multiple data providers; MP-SPDZ / MPyC / mpz sidecar) | Material for the Open Questions |
| SEP submission (Reference Implementation section updated) | The Reference Implementation section of `docs/spec/verifiable-tools.md` was updated with the implemented phases (1–4-a), the appendix format profiles (risc0-v1 / ezkl-v1 / tee-nitro-v1 / oracle-sig-v1 / zktls-tlsn-v1), and links to CI and `docs/BENCHMARKS.md` (Phase 3 figures copied in) and the test-file mapping. Remaining: the SEP PR to `modelcontextprotocol/modelcontextprotocol` and the `experimental-ext-*` incubation decision are not started | SEP PR |

### 5.1 Library selection (the #3 / #4 conclusions)

| Role | First choice | Alternatives | Integration | Notes |
|---|---|---|---|---|
| Small-circuit SNARK | `snarkjs` + Circom | Noir (`@noir-lang/noir_js` + `@aztec/bb.js`) | in-process (npm / WASM) | Groth16 needs a per-circuit setup. Noir is universal / setup-free with official TS integration |
| zkVM | RISC Zero (`risc0-v1`) | SP1 | sidecar (Rust, Docker) | No official TS bindings. receipt → Groth16 compression shrinks proofs to ~0.2 KB |
| ZKML | ezkl (`ezkl-v1`) | — | proving sidecar (Python / CLI), verification in-process (`@ezkljs/engine`) | For Scenario D (authenticated model inference) |
| TEE | AWS Nitro Enclaves (`tee-nitro-v1`) | Intel SGX DCAP (`tee-sgx-dcap-v1`, verification via sidecar), AMD SEV-SNP | generation in enclave, verification in-process (`cbor` + `@peculiar/x509`) | Verification stays in TS; generation uses the enclave-side SDK |
| Argument encryption | `hpke-js` (RFC 9180) | — | in-process | Replaces `x25519-aesgcm-demo-v1` |
| Input provenance | TLSNotary (`zktls-tlsn-v1`, on the PSE `mpz` foundation) | signed oracle (`oracle-sig-v1`) | sidecar | "Reliance on data providers" |
| FHE (future) | `node-seal` (SEAL WASM, BFV/CKKS) | TFHE-rs WASM / Concrete (Python) | in-process (encryption) + sidecar (evaluation) | Limited to a confidentiality demo until vFHE exists |
| MPC (future) | MP-SPDZ | MPyC (prototype), mpz / swanky (Rust) | sidecar | JS general-purpose MPC is unmaintained (JIFF) — not adopted |
| Canonicalization / hash | JCS (RFC 8785) + SHA-256 | — | in-process (Node `crypto`) | Replaces the previous `canonicalJson` with a JCS-compliant one |

Common checks at selection time (#3 §5): license (TFHE-rs / Concrete are
BSD-3-Clear), third-party audits, maintenance within the last 12 months, WASM
support, on-chain verifier output, and whether a trusted setup is required.

## 6. Spec-to-implementation map

| Spec section | Where implemented in the demo |
|---|---|
| Extension identifier / Capability object | `packages/protocol/src/constants.ts`, `packages/server/src/discover.ts` |
| Request metadata / HTTP headers | `packages/protocol/src/meta.ts`, `packages/server/src/http.ts` |
| Verifiable tool result (`_meta` fields) | `packages/protocol/src/types.ts`, `packages/prover/*` |
| Asynchronous proof generation via Tasks | `packages/server/src/tasks.ts`, `packages/client/src/tasks.ts` |
| Blind / committed-input tool calls | `packages/server/src/blind.ts`, `packages/client/src/blind.ts` |
| Verification flow | `packages/verifier/*`, `packages/client/src/client.ts` |
| Security Implications (VK pinning, format intersection) | `packages/verifier/src/registry.ts`, `packages/protocol/src/meta.ts` |
| Result binding (`outputCommitment` / `nonce` / salted commitments) | Phase 2-a: `packages/protocol/src/types.ts`, `packages/prover/*`, `packages/verifier/*`, `tests/binding.test.ts` |
| Tool descriptor metadata | Phase 2-a: `packages/server/src/tools.ts` (`tools/list` `_meta`), `packages/verifier/src/registry.ts` |
| Deferred proofs (`verifiable-tools/prove`) | Phase 2-a: `packages/server/src/prove.ts` (new), `tests/deferred-proof.test.ts` |
| Input provenance (`inputAttestations`) | Phase 3-d: `packages/verifier/src/provenance.ts`, `packages/server/src/pricefeed.ts`, `packages/prover-sidecar/src/provenance.ts`, `sidecars/tlsn`, `tests/provenance.test.ts`, `tests/tlsn-sidecar.test.ts` |
| TEE attestation formats | Phase 3-a: `packages/protocol/src/cose.ts`, `packages/verifier/src/tee-nitro.ts` (mock attestation) |
| Sidecar composition | Phase 3-a: `packages/prover-sidecar`, `packages/sidecar-mock`, `sidecars/`, `docker-compose.yml`. Phase 3-b: `sidecars/risc0`, `packages/prover-risc0` (WASM verification) |
| Rationale trade-off table / Performance measurement requirement | Phase 2-b onward: `docs/BENCHMARKS.md` |
| Testing Plan | `tests/*` |

## 7. Open questions

- How to handle a registry of `proofFormat` strings (same as the spec's Open
  Questions).
- Extension identifier: the implementation uses the vendor-prefixed
  `io.github.ripple-node-lab/verifiable-tools` because `io.modelcontextprotocol/`
  is reserved for official MCP extensions; on SEP acceptance the identifier
  (and the HPKE info labels derived from it) would move to
  `io.modelcontextprotocol/verifiable-tools`.
- The `tools/list` descriptor remains a hint; the concrete form of an
  out-of-band tool→`circuitHash` registry (signed manifest / transparency
  log).
- What state the server must retain during `resultTtlMs` for
  `verifiable-tools/prove` (the input itself vs. only the commitment and
  output), and how that coexists with blind calls.
- Whether a WASM build of the `risc0-zkvm` verifier is feasible → confirmed in
  Phase 3-b (wasm32 build ≈1.5 MB, verifies a real composite receipt in Node).
  Remaining: the model-size limits of `@ezkljs/engine`. The TS implementation
  cost of Nitro attestation verification was resolved in Phase 3-a.
- Whether to spin up vFHE (`fhe-tfhe-v1` with correctness guarantees) and an
  MPC / co-SNARK prover as phases, or keep them as open questions.
- Whether to put price / cost hints on the capability for Scenario A (tool
  marketplaces) (economic-incentive handling, #94 comment 3).
- Whether to incubate inside the MCP org as an experimental extension
  (`experimental-ext-*`, requires WG/IG affiliation) before SEP acceptance.

Resolved (2026-09 spec revision): `blindPublicKeys` / `blindEncryptionSchemes`
were made normative capability members; the Phase 4 port targets were decided
as canonical TS with Python as the ezkl complement; the spec now states that
`tasks/cancel` should stop the producer (implemented in Phase 2-a).

## 8. Extension-proposal procedure

Submitting an extension plan follows the procedure in
[issue #2](https://github.com/ripple-node-lab/mcp-verifiable-tools-demo/issues/2)
and uses the `.github/ISSUE_TEMPLATE/extension-proposal.md` template.

- Step 0: check consistency with the §2 design principles; if it deviates,
  state the reason.
- Step 1: create a Discussion issue with the template under the `proposal`
  label (one proposal = one issue).
- Step 2: after consensus, update status via the `accepted` /
  `needs-revision` / `rejected` labels.
- Step 3: include `Closes #<proposal issue>` in the PR and keep `docs/PLAN.md`
  and the spec in sync.
- Step 4: when a phase completes, confirm its deliverables and move on to
  SEP-2133 work (reference implementation in an official SDK, SEP submission).
