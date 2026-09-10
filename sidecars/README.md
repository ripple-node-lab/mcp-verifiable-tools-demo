# Sidecars

Proving backends that do not run inside TypeScript (Rust / Python / enclave,
etc.) are composed as HTTP sidecars (`docs/PLAN.md` §2, §5). The MCP server
calls them through the `SidecarProver` / `SidecarVerifier` adapter in
`packages/prover-sidecar` and always checks that the binding fields
(`circuitHash` / `inputCommitment` / `outputCommitment` / `nonce`) were echoed
unmodified by the sidecar.

## HTTP contract

| Endpoint | Contents |
|---|---|
| `GET /healthz` | `{ "status": "ok", "formats": ["<format>", ...] }` |
| `POST /prove` | body = `ProveInput` (`circuitHash` / `inputCommitment` / `outputCommitment` / `nonce?` / `output` / `verificationKeyUri?`) → `VerifiableToolsMeta` JSON |
| `POST /verify` | `{ "meta": VerifiableToolsMeta, "expectedCircuitHash": string }` → `{ "ok": boolean, "reason"?: string }` |
| `GET /vk/{circuitHash}` | verification key PEM (formats that carry a public key only) |

## Sidecars

- `sidecars/mock/` (`demo-sig-sidecar-v1`): reference implementation of the
  contract. Offers the same Ed25519 construction as `demo-sig-v1` under a
  different format name.
- `sidecars/nitro/`: mock-attestation fixtures for `tee-nitro-v1`
  (mock root CA, mock PCRs; the attestation is currently generated in-process
  by `TeeNitroProver`).
- `sidecars/risc0/` (`risc0-v1`): Rust sidecar for RISC Zero zkVM
  (`risc0-zkvm` 3.0.6 pinned; `tiny_http` + `serde_json` only, no tokio).
  The `add` guest takes `(a, b): (u32, u32)`, computes `a.checked_add(b)`, and
  commits a 12-byte little-endian journal (`a || b || sum`).
  `circuitHash` = guest image ID (committed at `sidecars/risc0/image-id.txt`,
  checked at startup via `RISC0_EXPECT_IMAGE_ID_FILE`).
  The image ID derives from the guest ELF memory image and is sensitive to
  build-machine path embedding, so the canonical value is the output of
  building `sidecars/risc0/Dockerfile` (pinned toolchain fetched directly from
  GitHub releases: rust r0.1.97.0 / r0cpp 2024.01.05 / cargo-risczero 3.0.6,
  no rzup dependency). An image ID produced by a host `cargo build` may not
  match (compose catches this at startup via `RISC0_EXPECT_IMAGE_ID_FILE`).
  With `RISC0_DEV_MODE` the sidecar returns Fake receipts (`/verify` rejects
  them with `devModeReceipt` unless dev mode is on). Concurrent proves are
  limited by `MAX_CONCURRENT_PROOFS` (default 1); overflow gets
  503 `{"error":"busy"}`. Cancelling an in-flight prove is not supported
  (`SidecarProver`'s abort only closes the HTTP request; the r0vm job runs to
  completion).
  Because `risc0-v1` publicInputs are a fixed six-element layout, `POST /prove`
  rejects a non-empty `inputAttestations` with
  400 `{"error":"unsupported: risc0-v1 does not carry inputAttestations"}` —
  input provenance cannot be bound into this format.
  Verification defaults to in-process WASM (`sidecars/risc0/wasm-verify` built
  for wasm32 via `build-wasm.sh` → `packages/prover-risc0/wasm`); the sidecar's
  `/verify` is also implemented per the contract.
- `sidecars/ezkl/` (`ezkl-v1`): Python `ezkl` ZKML sidecar
  (`python:3.12-slim` + `ezkl==22.0.1` pinned, stdlib `http.server` only).
  The circuit is a single ONNX `Add` node; `input_scale=0` /
  `param_scale=0` (logrows=14) maps integers exactly to field elements. The
  input domain is restricted to `a, b ∈ [0, 2^24]` (ONNX FLOAT inputs are
  exact only below 2^24; the range-check decomposition tops out at 2^28, so
  `a+b ≤ 2^25` is safe). Out-of-range inputs get 400 `invalidArguments`
  (-32602 server-side).
  `circuitHash` = sha256(`vk.json`). At startup `ezkl.setup` regenerates the
  pk (117 MB) and the produced vk is sha256-compared against the committed vk.
  The 22.0.1 pin is required (`@ezkljs/engine` ships 22.0.1 only; mismatched
  proof/vk/settings formats fail verification). `get_srs` is broken in 22.0.1,
  so the committed perpetual powers-of-tau SRS (`kzg.srs`, 2.1 MB) is used
  (`gen_srs` output fails engine verification).
  `MAX_CONCURRENT_PROOFS` (default 1) semaphore-limits proves; overflow gets
  503 `{"error":"busy"}`. Cancelling an in-flight prove is not supported.
  Verification is in-process via the `@ezkljs/engine` wasm (≈9.8 MB,
  `packages/prover-ezkl`).
- `sidecars/tlsn/` (`zktls-tlsn-v1`): TLSNotary input-provenance sidecar
  (Phase 3-d). A single Rust binary plays three roles: a loopback HTTPS
  fixture (`test-server.io`, `GET /v1/price/{symbol}` → deterministic
  demoPrice JSON), an in-process notary (secp256k1, generated at startup or
  `TLSN_NOTARY_KEY_HEX`), and the HTTP API (`PORT` 4400). `POST /attest`
  returns an `InputAttestation` (`proof` = base64url bincode Presentation);
  `POST /verify` verifies the Presentation, the notary key, and the disclosed
  request line / response body and returns `{ok, serverName, data}`. The
  notary key is distributed via `GET /notary-key` (SPKI PEM), which clients
  pin through the origin-allowlisted registry. In-process TS verification is
  impossible — `tlsn-core` needs `getrandom` on bare wasm32 — so verification
  is delegated to the sidecar. Exceeding `MAX_CONCURRENT_ATTESTATIONS`
  (default 1) gets 503 `{"error":"busy"}`.

## Running them

```sh
docker compose --profile sidecar up --build -d --wait
SIDECAR_URL=http://127.0.0.1:4100 npm run test:sidecar
docker compose --profile sidecar down
```

With `SIDECAR_URL` set, `tests/sidecar.test.ts` additionally runs a smoke test
against the external sidecar (the CI opt-in job uses this).

risc0 sidecar (prove ≈20–50 s, opt-in):

```sh
docker compose --profile risc0 up --build -d --wait
RISC0_SIDECAR_URL=http://127.0.0.1:4200 node --test tests/dist/risc0-sidecar.test.js
docker compose --profile risc0 down
```

ezkl sidecar (prove ≈2–3 s, opt-in):

```sh
docker compose --profile ezkl up --build -d --wait
EZKL_SIDECAR_URL=http://127.0.0.1:4300 node --test tests/dist/ezkl-sidecar.test.js
docker compose --profile ezkl down
```

tlsn sidecar (attest ≈1 s, opt-in):

```sh
docker compose --profile tlsn up --build -d --wait
TLSN_SIDECAR_URL=http://127.0.0.1:4400 node --test tests/dist/tlsn-sidecar.test.js
docker compose --profile tlsn down
```
