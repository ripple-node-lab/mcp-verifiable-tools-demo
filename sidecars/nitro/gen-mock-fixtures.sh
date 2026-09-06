#!/bin/sh
# Generates MOCK AWS-Nitro-style attestation fixtures for tee-nitro-v1 tests.
# These are test fixtures only: NOT the AWS Nitro root, NOT secrets.
set -eu
dir="$(cd "$(dirname "$0")" && pwd)/mock-fixtures"
mkdir -p "$dir"
cd "$dir"

openssl ecparam -name secp384r1 -genkey -noout -out root-key.pem
openssl req -x509 -new -key root-key.pem -sha384 -days 36500 \
  -subj "/CN=MOCK Nitro Root (NOT AWS)" -out root.pem

openssl ecparam -name secp384r1 -genkey -noout -out leaf-key.pem
openssl req -new -key leaf-key.pem -subj "/CN=MOCK Nitro Attestation Leaf" -out leaf.csr
openssl x509 -req -in leaf.csr -CA root.pem -CAkey root-key.pem -CAcreateserial \
  -sha384 -days 36500 -out leaf.pem

openssl ecparam -name secp384r1 -genkey -noout -out untrusted-root-key.pem
openssl req -x509 -new -key untrusted-root-key.pem -sha384 -days 36500 \
  -subj "/CN=MOCK Untrusted Root (NOT AWS)" -out untrusted-root.pem

node -e '
const { createHash } = require("node:crypto");
const { writeFileSync } = require("node:fs");
const pcrs = {};
for (const i of [0, 1, 2]) pcrs[String(i)] = createHash("sha384").update("mock-pcr" + i).digest("hex");
writeFileSync("pcrs.json", JSON.stringify(pcrs, null, 2) + "\n");
'

rm -f root-key.pem untrusted-root-key.pem leaf.csr root.srl
echo "fixtures written to $dir"
