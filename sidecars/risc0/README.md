# risc0 sidecar (`risc0-v1`)

RISC Zero zkVM proving sidecar for the verifiable-tools demo. The `add` guest
reads `(a, b): (u32, u32)` via `env::read`, computes `a.checked_add(b)` (panic
on overflow) and commits a 12-byte little-endian journal `a || b || sum`.
The receipt is a RISC Zero composite receipt (bincode-serialized). Input /
output / nonce binding follows the `snarkjs-v2` / `noir-v1` pattern — it lives
in `publicInputs` (`[outputCommitment, inputCommitment, nonce ?? "0x", sum, a, b]`),
not inside the guest. `circuitHash` is the guest image ID (32-byte hex).

## Layout

- `methods/guest/` — zkVM guest (`add_guest`), own cargo workspace + `Cargo.lock`
- `methods/` — `embed_methods` glue; generates `ADD_GUEST_ELF` / `ADD_GUEST_ID`
- `host/` — HTTP sidecar binary (`tiny_http`, one thread per request)
- `wasm-verify/` — verify-only `risc0-zkvm` crate compiled to
  `wasm32-unknown-unknown`; `build-wasm.sh` copies the artifact to
  `packages/prover-risc0/wasm/risc0_verify.wasm` (committed)
- `fixtures/` — `add-receipt.b64` / `add-receipt-dev.b64` receipts used by
  `tests/risc0.test.ts`
- `image-id.txt` — canonical guest image ID, pinned in
  `packages/protocol/src/meta.ts` (`PINNED_CIRCUITS.add.formats["risc0-v1"]`)

## Build & run

Local (needs the rzup toolchain layout under `~/.risc0`: rust 1.97.0 +
r0cpp 2024.1.5 + cargo-risczero 3.0.6, or `rzup install`):

```sh
cargo build --release
./target/release/host
```

Docker (canonical — see "Image ID" below):

```sh
docker compose --profile risc0 up --build -d --wait   # repo root
docker compose --profile risc0 down
```

Env: `HOST`/`PORT` (default `0.0.0.0:4200`), `RISC0_DEV_MODE` (return
Fake receipts; `/verify` rejects them unless this is set),
`RISC0_EXPECT_IMAGE_ID_FILE` (assert image ID at startup, set by compose),
`MAX_CONCURRENT_PROOFS` (default `1`; excess `/prove` → 503 `{"error":"busy"}`).
Aborting an in-flight proof is not supported: the `SidecarProver` abort only
closes the HTTP request; the proving job runs to completion.

## HTTP contract (same shape as the mock sidecar)

- `GET /healthz` → `{"status","formats":["risc0-v1"],"imageId","devMode","maxConcurrentProofs"}`
- `POST /prove` — body `ProveInput`; validates `circuitHash == imageId` → 400
  `circuitHashMismatch`, args must be u32 with `a+b` ≤ u32::MAX → 400
  `invalidArguments`, `output == sum` → 400 `outputMismatch`. Response is the
  `VerifiableToolsMeta` (proof = base64url bincode receipt, ≈222 KB).
- `POST /verify` — `{meta, expectedCircuitHash}` → `{ok}` or
  `{ok:false, reason}` where reason ∈ `malformed | circuitHashMismatch |
  receiptInvalid | devModeReceipt | publicInputsMismatch | journalMismatch`.
- `GET /vk/{imageId}` → `{"format":"risc0-v1","imageId"}` or 404.
- Body limit 2 MiB.

## Image ID and fixtures

The image ID derives from the guest ELF memory image, which embeds build-path
strings — so host builds are **not** reproducible across checkouts. The
canonical value is produced by `sidecars/risc0/Dockerfile` (pinned toolchain
tarballs from GitHub releases, no rzup). To bump it:

```sh
docker compose --profile risc0 up --build -d --wait
docker compose logs sidecar-risc0   # imageId=0x… on the startup line
echo <id> > sidecars/risc0/image-id.txt
node scripts/update-pins.mjs        # repo root; updates PINNED_CIRCUITS
```

Regenerate fixtures by POSTing `/prove` to a running container (and a
`RISC0_DEV_MODE=1` container for the dev fixture), then rebuild the committed
wasm verifier with `wasm-verify/build-wasm.sh` when `risc0-zkvm` changes.

## Tests

```sh
npm test                                                  # fixtures, in-process WASM verify
RISC0_SIDECAR_URL=http://127.0.0.1:4200 \
  node --test tests/dist/risc0-sidecar.test.js            # real prove, ~20–60 s
```
