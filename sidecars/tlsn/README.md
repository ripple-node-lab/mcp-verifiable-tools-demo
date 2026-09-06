# zktls-tlsn-v1 sidecar

TLSNotary-backed input provenance. A single binary runs three roles: a
loopback HTTPS fixture standing in for a real exchange API
(`test-server.io`, `GET /v1/price/{symbol}`), an in-process notary with a
secp256k1 signing key (random per startup, or pinned via
`TLSN_NOTARY_KEY_HEX`), and the HTTP API.

- `GET /healthz` → `{status, types: ["zktls-tlsn-v1"], notaryKeyUri, maxConcurrentAttestations}`
- `GET /notary-key` → SPKI PEM of the notary's secp256k1 verifying key
- `POST /attest {"source": "https://test-server.io/v1/price/AAPL"}` → an
  `InputAttestation` (`type`, `source`, `commitment` = sha256(data), `data`,
  `proof` = base64url bincode `Presentation`, `notaryKeyUri`). The source must
  be `https://test-server.io/v1/price/<symbol>` else `400 invalidSource`.
  503 `{"error":"busy"}` when `MAX_CONCURRENT_ATTESTATIONS` is saturated.
- `POST /verify {"attestation": ..., "notaryKeyPem": "..."}` →
  `200 {ok:true, serverName, data}` or `200 {ok:false, reason}`; `400` only
  for malformed requests. Verification pins the notary key, checks the
  revealed request line (`GET <source path>`), extracts the response body
  (rejecting redacted bytes inside it), and compares
  `sha256(body) == commitment` and `body == data`.

Env: `PORT` (4400), `HOST` (0.0.0.0), `PUBLIC_URL`, `TLSN_NOTARY_KEY_HEX`,
`MAX_CONCURRENT_ATTESTATIONS` (1).

## Trust model

The presentation is verified **inside the sidecar** (`tlsn-core` does not
build for bare `wasm32-unknown-unknown` — `getrandom`), so the TypeScript
client calls `/verify` over the attestation. The notary key is the trust
anchor: clients fetch it through the origin-allowlisted
`VerificationKeyRegistry` (pinned by `notaryKeyUri`), so a sidecar swap to a
different notary key is detected. `data` (the revealed body) is a demo
extension of the `InputAttestation` spec; the fixture server stands in for a
real exchange API.
