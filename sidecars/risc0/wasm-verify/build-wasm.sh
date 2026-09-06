#!/usr/bin/env bash
# Builds the in-process risc0 receipt verifier to wasm32 and installs it
# into packages/prover-risc0/wasm/risc0_verify.wasm.
# Requires: rustup target add wasm32-unknown-unknown
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
rustup target add wasm32-unknown-unknown
cargo build --target wasm32-unknown-unknown --release --locked
cp target/wasm32-unknown-unknown/release/risc0_wasm_verify.wasm \
   "$ROOT/../../../packages/prover-risc0/wasm/risc0_verify.wasm"
echo "wrote packages/prover-risc0/wasm/risc0_verify.wasm ($(stat -c%s "$ROOT/../../../packages/prover-risc0/wasm/risc0_verify.wasm") bytes)"
