# MCP Verifiable Tools Demo

Reference implementation of the `io.github.ripple-node-lab/verifiable-tools`
extension on MCP `2026-07-28` (TypeScript, Streamable HTTP). It demonstrates
capability negotiation, locally verified tool results, asynchronous proof
generation through the `io.modelcontextprotocol/tasks` extension, blind
committed-input calls with HPKE-encrypted arguments, input provenance
(`inputAttestations`), HTTP sidecar composition for provers that are not
TypeScript, and an adapter onto the published `@modelcontextprotocol/sdk`
1.30.0.

**Status:** Phases 1–4-a of [docs/PLAN.md](docs/PLAN.md) are implemented and
tested in CI; Phase 4-b (rebasing the SDK adapter on the v2 `server/discover`
surface) is pending publication of an SDK release that speaks `2026-07-28`.

> **Demo, not production.** `demo-sig-v1`, `demo-commit-v1`,
> `demo-sig-sidecar-v1`, `oracle-sig-v1`, and the `tee-nitro-v1` mock
> certificate chain are teaching artefacts, not production-grade evidence.
> See [docs/SECURITY.md](docs/SECURITY.md).

## Proof formats at a glance

| Format | Kind | Prover runs | Verifier runs | Real or demo |
|---|---|---|---|---|
| `demo-sig-v1` | Ed25519 signature over bound fields | in-process TS | in-process TS | demo (not a ZK proof) |
| `demo-commit-v1` | SHA-256 commitment | in-process TS | in-process TS | demo (not a ZK proof) |
| `hpke-v1` | RFC 9180 base-mode encryption for blind arguments | in-process TS (client encrypts) | in-process TS (server decrypts) | reference impl with `node:crypto`; not a proof format |
| `snarkjs-v2` | Groth16 (Circom `add` circuit) | in-process TS (`snarkjs`) | in-process TS | real proof; **insecure** single-party demo trusted setup |
| `noir-v1` | UltraHonk (Noir `u32` add) | in-process TS (`noir_js` + `bb.js`) | in-process TS | real proof; no trusted setup |
| `risc0-v1` | RISC Zero zkVM receipt | Rust sidecar (`sidecars/risc0`, docker profile `risc0`) | in-process WASM (`risc0-zkvm`); sidecar `/verify` also available | real proof |
| `ezkl-v1` | ezkl/Halo2-KZG ZKML | Python sidecar (`sidecars/ezkl`, profile `ezkl`) | in-process WASM (`@ezkljs/engine`); sidecar `/verify` also available | real proof; inputs restricted to `a, b ∈ [0, 2^24]` |
| `tee-nitro-v1` | COSE_Sign1 / CBOR Nitro-style attestation | in-process TS (mock fixtures) | in-process TS | demo: mock root CA + mock PCRs (`sidecars/nitro/mock-fixtures`) |
| `demo-sig-sidecar-v1` | Ed25519 via the sidecar contract | HTTP sidecar (`packages/sidecar-mock`, profile `sidecar`) | in-process TS | demo (not a ZK proof) |
| `oracle-sig-v1` | input attestation (Ed25519 over JCS payload) | in-process (`OraclePriceFeed`) | in-process TS | demo |
| `zktls-tlsn-v1` | input attestation (TLSNotary presentation) | Rust sidecar (`sidecars/tlsn`, profile `tlsn`) | sidecar `/verify` (`tlsn-core` does not build for bare wasm32) | real attestation protocol against a loopback fixture host |

## Quick start

Requires Node.js 20 or later (CI runs the suite on 20, 22 and 24).

### Scenarios 1–7 (no Docker)

Nothing to install beyond `npm install`; the demo spawns its own server.
Scenarios 8–10 print `skipped` with the command that enables them.

```sh
npm install
npm test     # builds packages and runs the test suite
npm run demo # builds (incremental) then runs the self-contained demo
```

### Scenarios 8–10 as well (Docker required)

Scenarios 8 (RISC Zero), 9 (ezkl) and 10 (TLSNotary) call Rust/Python prover
sidecars that run as docker compose profiles. Start them once before the demo
and point the client at them via env vars:

```sh
docker compose --profile risc0 --profile ezkl --profile tlsn up --build -d --wait
export RISC0_SIDECAR_URL=http://127.0.0.1:4200
export EZKL_SIDECAR_URL=http://127.0.0.1:4300
export TLSN_SIDECAR_URL=http://127.0.0.1:4400
npm run demo
docker compose --profile risc0 --profile ezkl --profile tlsn down   # when finished
```

Notes:

- Needs Docker Engine/Desktop with the compose plugin. The first `--build`
  compiles the Rust (risc0, tlsn) and Python (ezkl) images and can take tens
  of minutes; later starts reuse the cached images.
- `--wait` blocks until each sidecar's health check passes (ezkl regenerates
  its proving key at startup, so this can take a minute).
- Scenario 8 produces a real zkVM receipt on the CPU (≈20 s per proof, several
  GB of RAM), so the demo pauses noticeably there.
- Apple Silicon / arm64: the `risc0` image is x86_64-only and is pinned to
  `platform: linux/amd64`, so Docker Desktop runs it under Rosetta/QEMU
  emulation — build and proving are noticeably slower (the ≈20 s proof can
  take several minutes). `ezkl` and `tlsn` build natively. If it is too slow,
  omit `--profile risc0` and run 9–10 only.
- Any subset works: start only the profiles you want and set only their env
  vars; the others stay `skipped`. Ports and gated tests are listed in
  [docs/DEMOS.md](docs/DEMOS.md#sidecars).

To run the server standalone (default port 3939, override with `PORT`):

```sh
npm run server
curl -sS http://127.0.0.1:3939/mcp \
  -H 'Content-Type: application/json' \
  -H 'MCP-Protocol-Version: 2026-07-28' \
  -H 'Mcp-Method: server/discover' \
  -d '{"jsonrpc":"2.0","id":1,"method":"server/discover","params":{}}'
```

## Security

The client pins verification keys by `circuitHash` and rejects results whose
tool-to-circuit mapping diverges; this demo keeps that mapping fixed in the
protocol package. The server listens on loopback HTTP only. The demo formats
are not zero-knowledge and no authentication or principal binding exists —
see [docs/SECURITY.md](docs/SECURITY.md) for the consolidated list of
caveats and the spec's Security Implications section.

## Documentation

- [docs/DEMOS.md](docs/DEMOS.md) — running every demo, sidecar, and test; expected output; error codes.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — repository layout, request flow, sidecar contract, SDK adapter layering.
- [docs/SECURITY.md](docs/SECURITY.md) — trust model, caveats, and known limitations.
- [docs/BENCHMARKS.md](docs/BENCHMARKS.md) — measured figures (Phase 2-b in-process; Phase 3 sidecar formats).
- [docs/PLAN.md](docs/PLAN.md) — phased implementation plan and status.
- [docs/spec/verifiable-tools.md](docs/spec/verifiable-tools.md) — extension specification, SEP draft.
- [docs/EXTENSIONS.md](docs/EXTENSIONS.md) — upstream extension landscape notes.
- [sidecars/README.md](sidecars/README.md) — sidecar contract and per-sidecar details.
- Tracking: [zk-tokyo/advanced-cryptography-2026 issue #94](https://github.com/zk-tokyo/advanced-cryptography-2026/issues/94).

Extension identifiers: `io.github.ripple-node-lab/verifiable-tools` and
`io.modelcontextprotocol/tasks`. The vendor prefix is used because
`io.modelcontextprotocol/` is reserved for official MCP extensions.
