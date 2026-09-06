# MCP Verifiable Tools Demo

This repository is a dependency-free Phase 1 + Phase 2-a + Phase 3-a reference
demo for the `io.modelcontextprotocol/verifiable-tools` extension on MCP
`2026-07-28`. It demonstrates capability negotiation, locally verified tool
results, asynchronous proof generation through Tasks, blind committed-input
calls, a verifiable TEE attestation format (`tee-nitro-v1`), and HTTP sidecar
composition for provers that are not TypeScript.

> **DISCLAIMER:** `demo-sig-v1` and `demo-commit-v1` are teaching/demo formats,
> not cryptographic zero-knowledge proofs. `hpke-v1` is RFC 9180 base mode
> implemented with `node:crypto`; it is provided for reference, not as a
> production security deployment. `tee-nitro-v1` verifies a COSE_Sign1
> attestation certificate chain, PCR measurement, key binding via `user_data`,
> and freshness — but against a MOCK root CA and MOCK PCRs shipped in
> `sidecars/nitro/mock-fixtures`, not the AWS Nitro Enclaves root. Do not use
> this implementation for production security. See the [plan](docs/PLAN.md),
> especially §2.

## Quick start

```sh
npm install
npm test
npm run demo
```


To run the server:

```sh
npm run server
curl -sS http://127.0.0.1:3939/mcp \
  -H 'Content-Type: application/json' \
  -H 'MCP-Protocol-Version: 2026-07-28' \
  -H 'Mcp-Method: server/discover' \
  -d '{"jsonrpc":"2.0","id":1,"method":"server/discover","params":{}}'
```

The extension identifier is `io.modelcontextprotocol/verifiable-tools`.
The demo also advertises `io.modelcontextprotocol/tasks`.

## Security notes

The client pins verification keys by circuit hash and rejects results whose
tool-to-circuit mapping does not match its expected mapping. In a real
deployment, that mapping must come from an out-of-band trusted registry; this
demo keeps it fixed in the protocol package.

- The demo listens on plain `http://127.0.0.1` only. Any non-loopback
  deployment must use TLS, because discovery (including the blind public key
  and `verificationKeyUri`) can otherwise be replaced by a network attacker.

## Sidecars (opt-in)

Proof backends that are not TypeScript run as HTTP sidecars (see
[sidecars/README.md](sidecars/README.md)). A mock sidecar implementing the
contract for `demo-sig-sidecar-v1` is included:

```sh
docker compose --profile sidecar up --build -d --wait
SIDECAR_URL=http://127.0.0.1:4100 npm run test:sidecar
docker compose --profile sidecar down
```

`npm test` never requires sidecars; the docker path is exercised by an opt-in
CI job.

## Repository layout

- `packages/protocol`: extension constants, types, metadata, negotiation, and
  minimal CBOR (RFC 8949) / COSE_Sign1 (RFC 9052) codecs.
- `packages/prover`: Ed25519 signature, SHA-256 commitment, and `tee-nitro-v1`
  (mock-attested COSE_Sign1) demo provers.
- `packages/verifier`: local verifiers, verification-key pinning, and the
  `tee-nitro-v1` attestation verifier.
- `packages/server`: Streamable HTTP MCP server and demo tools.
- `packages/client`: verifying client and five-scenario demo.
- `packages/prover-sidecar`: HTTP sidecar contract adapter (`SidecarProver`,
  `SidecarVerifier`, `sidecarHealth`).
- `packages/sidecar-mock`: reference sidecar implementing `demo-sig-sidecar-v1`.
- `sidecars`: sidecar README, mock Dockerfile, and Nitro mock fixtures.
- `examples`: representative JSON-RPC messages.
- `tests`: deterministic `node:test` integration tests.

Further reading: [English specification](docs/spec/verifiable-tools.md),
[Japanese specification](docs/spec/verifiable-tools.ja.md), and
[the implementation plan](docs/PLAN.md). Discussion and tracking live in
[issue #94](https://github.com/zk-tokyo/advanced-cryptography-2026/issues/94).
The specification now includes use-case narrative and result-binding fields
(`outputCommitment` / `nonce` / `tools/list` descriptors / `inputAttestations` /
deferred proofs), implemented here through Phase 3-a of [docs/PLAN.md](docs/PLAN.md).
The demo proof formats are not zero-knowledge; `hpke-v1` is real RFC 9180 base mode
implemented with `node:crypto` and self-tested against the RFC vector. Expired
`resultId` values return `resultExpired` for 2×TTL after expiry because of the
retained tombstone, then return `resultNotFound`; principal/session binding is
not implemented because this demo has no authentication.

## 日本語

### 概要

MCP `2026-07-28` 上で `io.modelcontextprotocol/verifiable-tools` 拡張の
ネゴシエーション、証明メタデータのローカル検証、Tasks による非同期処理、
暗号化した引数によるブラインド実行を示す依存ゼロのデモです。
Phase 1 + Phase 2-a + Phase 3-a の実装を含み、`demo-sig-v1` と
`demo-commit-v1` は ZK 証明ではなく、`hpke-v1` は `node:crypto` による
RFC 9180 base mode です。`tee-nitro-v1` は COSE_Sign1 attestation の
証明書チェーン・PCR measurement・`user_data` による鍵束縛・freshness を
実際に検証しますが、検証先は `sidecars/nitro/mock-fixtures` に同梱した
モック root CA とモック PCR であり、AWS Nitro Enclaves の root では
ありません。TS で閉じない証明バックエンドは HTTP sidecar として合成します
（`sidecars/README.md` 参照）。

```sh
docker compose --profile sidecar up --build -d --wait
SIDECAR_URL=http://127.0.0.1:4100 npm run test:sidecar
docker compose --profile sidecar down
```
仕様にはユースケースの説明と結果束縛フィールド（`outputCommitment` / `nonce` /
`tools/list` 記述子 / `inputAttestations` / 遅延証明）も含まれており、
docs/PLAN.md の Phase 2-a で実装済みです。なお、デモは `resultId` の principal
binding（認可主体への束縛）を実装していません。期限切れの `resultId` は、
保持された tombstone により期限切れ後 2×TTL の間は `resultExpired` を返し、
その後は `resultNotFound` を返します。デモには認証がないため、principal/session
binding は実装していません。

### クイックスタート

```sh
npm install
npm test
npm run demo
```