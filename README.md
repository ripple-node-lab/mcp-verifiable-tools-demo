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

```sh
npm install
npm test     # builds packages and runs the test suite (no docker needed)
npm run demo # self-contained: spawns a DemoServer on a random port
```

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
