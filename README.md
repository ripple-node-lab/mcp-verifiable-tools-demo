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

## Repository layout

- `packages/protocol`: extension constants, types, metadata, and negotiation.
- `packages/prover`: Ed25519 signature and SHA-256 commitment demo provers.
- `packages/verifier`: local verifiers and verification-key pinning.
- `packages/server`: Streamable HTTP MCP server and demo tools.
- `packages/client`: verifying client and three-scenario demo.
- `examples`: representative JSON-RPC messages.
- `tests`: deterministic `node:test` integration tests.

Further reading: [English specification](docs/spec/verifiable-tools.md),
[Japanese specification](docs/spec/verifiable-tools.ja.md), and
[the implementation plan](docs/PLAN.md). Discussion and tracking live in
[issue #94](https://github.com/zk-tokyo/advanced-cryptography-2026/issues/94).

## 日本語

### 概要

MCP `2026-07-28` 上で `io.modelcontextprotocol/verifiable-tools` 拡張の
ネゴシエーション、証明メタデータのローカル検証、Tasks による非同期処理、
暗号化した引数によるブラインド実行を示す依存ゼロのデモです。

### クイックスタート

```sh
npm install
npm test
npm run demo
```