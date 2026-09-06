#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SNARK_DIR="$ROOT/packages/prover-snarkjs/circuits/add"
NOIR_DIR="$ROOT/packages/prover-noir/circuits/add"
SNARKJS="$ROOT/node_modules/.bin/snarkjs"

command -v circom >/dev/null || { echo "circom 2.2.x is required" >&2; exit 1; }
command -v nargo >/dev/null || { echo "nargo 1.0.0-beta.26 is required" >&2; exit 1; }
test -x "$SNARKJS" || { echo "snarkjs must be installed with npm ci" >&2; exit 1; }

case "$(circom --version)" in
  *"circom compiler 2.2."*) ;;
  *) echo "circom 2.2.x is required" >&2; exit 1 ;;
esac
case "$(nargo --version)" in
  *"nargo version = 1.0.0-beta.26"*) ;;
  *) echo "nargo 1.0.0-beta.26 is required" >&2; exit 1 ;;
esac

circom "$SNARK_DIR/add.circom" --r1cs --wasm --sym -l "$ROOT/node_modules" -o "$SNARK_DIR"
cp "$SNARK_DIR/add_js/add.wasm" "$SNARK_DIR/add.wasm"
rm -rf "$SNARK_DIR/add_js" "$SNARK_DIR/add.sym"

# This is an insecure single-party Powers of Tau ceremony for the demo only.
# It is not suitable for production or security-sensitive deployments.
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
"$SNARKJS" powersoftau new bn128 8 "$TMP/pot8_0000.ptau"
"$SNARKJS" powersoftau contribute "$TMP/pot8_0000.ptau" "$TMP/pot8_0001.ptau" \
  --name="mcp-verifiable-tools-demo" -e="demo-only-local-entropy"
"$SNARKJS" powersoftau prepare phase2 "$TMP/pot8_0001.ptau" "$TMP/pot.ptau"
"$SNARKJS" groth16 setup "$SNARK_DIR/add.r1cs" "$TMP/pot.ptau" "$SNARK_DIR/add_0000.zkey"
"$SNARKJS" zkey contribute "$SNARK_DIR/add_0000.zkey" "$SNARK_DIR/add_final.zkey" \
  --name="mcp-verifiable-tools-demo" -e="demo-only-zkey-entropy"
"$SNARKJS" zkey export verificationkey "$SNARK_DIR/add_final.zkey" "$SNARK_DIR/vk.json"
rm -f "$SNARK_DIR/add_0000.zkey"

(cd "$NOIR_DIR" && nargo compile)
node "$ROOT/scripts/write-noir-vk.mjs"
node "$ROOT/scripts/update-pins.mjs"
