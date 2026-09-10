# Architecture

## Request flow

A `tools/call` flows through the reference implementation as follows:

1. The `VerifiableClient` (`packages/client`) POSTs JSON-RPC to `POST /mcp`
   with `MCP-Protocol-Version: 2026-07-28`, `Mcp-Method`, and (for
   `tools/call`) `Mcp-Name` headers; `params._meta` carries the client's
   per-request `io.modelcontextprotocol/clientCapabilities` (including
   `capabilities.extensions`), the `protocolVersion`, and `clientInfo`.
2. `DemoServer.dispatch` (`packages/server`) routes the method:
   `server/discover`, `tools/list`, `tools/call`, `tasks/get`, `tasks/cancel`,
   `verifiable-tools/call`, `verifiable-tools/prove`. Header checks live in
   `packages/server/src/http.ts`.
3. The tool executes (`packages/server/src/tools/*`); a `Prover`
   (`packages/prover`, `packages/prover-snarkjs`, `packages/prover-noir`)
   produces `VerifiableToolsMeta` either in-process or — for
   `risc0-v1` / `ezkl-v1` / `demo-sig-sidecar-v1` — via `SidecarProver` over
   the sidecar HTTP contract (`packages/prover-sidecar`). When the client
   advertises the tasks extension and the work is async, the call returns a
   `{ resultType: "task", taskId, … }` envelope and the proof is resolved by
   `tasks/get` polling.
4. The `CallToolResult` carries the proof in
   `_meta["io.modelcontextprotocol/verifiable-tools"]` — `proof`,
   `proofFormat`, `circuitHash`, `inputCommitment`, `outputCommitment`,
   `nonce`, `publicInputs`, `verificationKeyUri`, and optionally
   `inputAttestations` — plus `_meta["io.modelcontextprotocol/serverInfo"]`.
5. The client verifies locally (`packages/verifier`): binding fields first
   (commitments, nonce, `circuitHash` pin), then the per-format `Verifier`
   (in-process TS/WASM for every proof format), then `verifyProvenance` for
   attached `inputAttestations` (`oracle-sig-v1` in-process;
   `zktls-tlsn-v1` delegated to the tlsn sidecar's `/verify` because
   `tlsn-core` does not build for bare wasm32). Verification keys are
   fetched through an origin-allowlisted registry
   (`packages/verifier/src/registry.ts`), served by `DemoServer` at
   `GET /vk/{circuitHash}` and `GET /oracle-keys/demo` — HTTP endpoints that
   sit outside JSON-RPC.

## Sidecar contract

Non-TypeScript provers run as HTTP sidecars exposing `GET /healthz`,
`POST /prove`, `POST /verify`, and `GET /vk/{circuitHash}`; the adapter
(`SidecarProver` / `SidecarVerifier` / `sidecarHealth`) enforces that the
sidecar echoes the binding fields unmodified. The tlsn sidecar additionally
exposes `POST /attest` (issues `zktls-tlsn-v1` `InputAttestation`s) and
`GET /notary-key`. See [../sidecars/README.md](../sidecars/README.md) for the
contract and per-sidecar details (mock / risc0 / ezkl / tlsn).

## SDK adapter layering (Phase 4-a)

`packages/sdk-extension` puts the extension on the published
`@modelcontextprotocol/sdk@1.30.0` without touching the protocol or
verification code: the SDK `Server`/`Client` own the transport and the
`initialize` handshake (`createVerifiableServer` registers
`capabilities.extensions` identical to `server/discover`'s via
`DemoServer.discoveryExtensions`); each extension method is a
`setRequestHandler` that delegates to `DemoServer.dispatch`; `tasks/get` and
`tasks/cancel` go through `fallbackRequestHandler` because the SDK gates them
on its own `capabilities.tasks` shape. On the client, `sdkRpc` adapts
`client.request` into `VerifiableClient`'s `rpc` seam, and one
`VerifiableExtensionCapability` value feeds both the SDK `Client`
constructor (`verifiableClientCapabilities`) and the per-request `_meta`
(`createVerifiableClient` → `setCapabilities`). The `DemoServer` still
`listen()`s so `/vk/*` and `/oracle-keys/*` remain available as key
distribution endpoints.

Known gaps against the 2026-07-28 wire: SDK 1.x negotiates `2025-11-25` at
`initialize` (the 2026-07-28 revision is only in the unpublished v2 alpha),
`Mcp-Method`/`Mcp-Name` header enforcement is SDK-transport specific and not
applied on this path, `tasks/*` are carried as extension custom methods
rather than the SDK's experimental tasks surface, and SDK 1.30.0's stateless
Streamable HTTP mode rejects the post-initialize notification (tests use
stateful sessions).

## Repository layout

- `packages/protocol`: extension constants, types, metadata, negotiation, and
  minimal CBOR (RFC 8949) / COSE_Sign1 (RFC 9052) codecs.
- `packages/prover`: Ed25519 signature, SHA-256 commitment, and `tee-nitro-v1`
  (mock-attested COSE_Sign1) demo provers.
- `packages/prover-snarkjs`: Circom/Groth16 `snarkjs-v2` prover and verifier.
- `packages/prover-noir`: Noir/UltraHonk `noir-v1` prover and verifier.
- `packages/verifier`: local verifiers, verification-key pinning, the
  `tee-nitro-v1` attestation verifier, and `provenance.ts`
  (`verifyProvenance`, `ProvenanceVerifier`, `OracleSigVerifier`).
- `packages/server`: Streamable HTTP MCP server, demo tools, and
  `pricefeed.ts` (`OraclePriceFeed` in-process, `TlsnPriceFeed` via the
  tlsn sidecar).
- `packages/client`: verifying client and ten-scenario demo.
- `packages/prover-risc0`: `risc0-v1` verifier (WASM build of `risc0-zkvm`).
- `packages/prover-ezkl`: `ezkl-v1` verifier (`@ezkljs/engine` WASM) and the
  committed `add` circuit artifacts (onnx / settings / vk / SRS).
- `packages/prover-sidecar`: HTTP sidecar contract adapter (`SidecarProver`,
  `SidecarVerifier`, `sidecarHealth`) plus `TlsnProvenanceVerifier` for
  `zktls-tlsn-v1` attestations.
- `packages/sdk-extension`: adapter onto `@modelcontextprotocol/sdk@1.30.0`
  (`attachVerifiableTools`/`createVerifiableServer`, `sdkRpc`/`createVerifiableClient`,
  `verifiableClientCapabilities`, `assertServerSupportsVerifiableTools`).
- `packages/sidecar-mock`: reference sidecar implementing `demo-sig-sidecar-v1`.
- `sidecars`: sidecar README, mock + risc0 + ezkl + tlsn Dockerfiles, Nitro mock
  fixtures, risc0 Rust workspace, wasm verifier source, ezkl sidecar + proof
  fixtures, tlsn Rust sidecar.
- `examples`: representative JSON-RPC messages (walked through in
  [DEMOS.md](DEMOS.md#raw-http-walkthrough)).
- `tests`: deterministic `node:test` integration tests.
