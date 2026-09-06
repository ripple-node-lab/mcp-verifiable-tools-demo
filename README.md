# MCP Verifiable Tools Demo

This repository is a dependency-free Phase 1 reference demo for the
`io.modelcontextprotocol/verifiable-tools` extension on MCP `2026-07-28`.
It demonstrates capability negotiation, locally verified tool results,
asynchronous proof generation through Tasks, and blind committed-input calls.

> **DISCLAIMER:** `demo-sig-v1` and `demo-commit-v1` are teaching/demo formats,
> not cryptographic zero-knowledge proofs. `x25519-aesgcm-demo-v1` is a small
> demonstration encryption scheme, not HPKE. Do not use this implementation
> for production security. See the [plan](docs/PLAN.md), especially §2.

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

## Repository layout

- `packages/protocol`: extension constants, types, metadata, and negotiation.
- `packages/prover`: Ed25519 signature and SHA-256 commitment demo provers.
- `packages/verifier`: local verifiers and verification-key pinning.
- `packages/server`: Streamable HTTP MCP server and demo tools.
- `packages/client`: verifying client and four-scenario demo.
- `examples`: representative JSON-RPC messages.
- `tests`: deterministic `node:test` integration tests.

Further reading: [English specification](docs/spec/verifiable-tools.md),
[Japanese specification](docs/spec/verifiable-tools.ja.md), and
[the implementation plan](docs/PLAN.md). Discussion and tracking live in
[issue #94](https://github.com/zk-tokyo/advanced-cryptography-2026/issues/94).
The specification now includes use-case narrative and result-binding fields
(`outputCommitment` / `nonce` / `tools/list` descriptors / `inputAttestations` /
deferred proofs), implemented here through Phase 2-a of [docs/PLAN.md](docs/PLAN.md).
The demo proof formats are not zero-knowledge; `hpke-v1` is real RFC 9180 base mode
implemented with `node:crypto` and self-tested against the RFC vector.

## 日本語

### 概要

MCP `2026-07-28` 上で `io.modelcontextprotocol/verifiable-tools` 拡張の
ネゴシエーション、証明メタデータのローカル検証、Tasks による非同期処理、
暗号化した引数によるブラインド実行を示す依存ゼロのデモです。
仕様にはユースケースの説明と結果束縛フィールド（`outputCommitment` / `nonce` /
`tools/list` 記述子 / `inputAttestations` / 遅延証明）も含まれており、
docs/PLAN.md の Phase 2-a で実装済みです。なお、デモは `resultId` の principal
binding（認可主体への束縛）を実装していません。

### クイックスタート

```sh
npm install
npm test
npm run demo
```