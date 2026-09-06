# MCP Verifiable Tools Demo

This repository is a Phase 1 + Phase 2-a + Phase 2-b reference demo for the
`io.modelcontextprotocol/verifiable-tools` extension on MCP `2026-07-28`.
It demonstrates capability negotiation, locally verified tool results,
asynchronous proof generation through Tasks, and blind committed-input calls.

> **DISCLAIMER:** `demo-sig-v1` and `demo-commit-v1` are teaching/demo formats,
> not cryptographic zero-knowledge proofs. `hpke-v1` is RFC 9180 base mode
> implemented with `node:crypto`; it is provided for reference, not as a
> production security deployment. Do not use this implementation for production
> security. See the [plan](docs/PLAN.md), especially §2.

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
- `packages/prover-snarkjs`: Circom/Groth16 `snarkjs-v2` prover and verifier.
- `packages/prover-noir`: Noir/UltraHonk `noir-v1` prover and verifier.
- `packages/verifier`: local verifiers and verification-key pinning.
- `packages/server`: Streamable HTTP MCP server and demo tools.
- `packages/client`: verifying client and six-scenario demo.
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
implemented with `node:crypto` and self-tested against the RFC vector. Expired
`resultId` values return `resultExpired` for 2×TTL after expiry because of the
retained tombstone, then return `resultNotFound`; principal/session binding is
not implemented because this demo has no authentication.

## Phase 2-b real ZK profiles

The `add` tool also advertises two real in-process proof profiles:

- `snarkjs-v2`: Groth16 over the committed Circom 32-bit addition circuit.
  It is a real proof, but the checked-in proving key uses an insecure,
  single-party local Powers of Tau ceremony for demonstration only.
- `noir-v1`: UltraHonk over the committed Noir `u32` addition circuit. It is a
  real proof and requires no trusted setup.

`circuitHash` is `0x` plus SHA-256 of the exact verification-key document bytes
served at `verificationKeyUri`. The committed source and generated artifacts
are under `packages/prover-snarkjs/circuits` and
`packages/prover-noir/circuits`.

To rebuild artifacts locally, install Circom 2.2.x, Nargo 1.0.0-beta.26, and
the pinned npm dependencies, then run:

```sh
./scripts/build-circuits.sh
```

The script creates a local single-party Powers of Tau ceremony. Its output is
intentionally insecure and demo-only; `.ptau` files and intermediate zkeys are
ignored and are not committed. Run `npm run bench` to regenerate the
machine-specific measurements in [`docs/BENCHMARKS.md`](docs/BENCHMARKS.md).
bb.js 5.2.0 emits a proof-generation status line to stdout for each proof.

## 日本語

### 概要

MCP `2026-07-28` 上で `io.modelcontextprotocol/verifiable-tools` 拡張の
ネゴシエーション、証明メタデータのローカル検証、Tasks による非同期処理、
暗号化した引数によるブラインド実行を示すデモです。
Phase 1 + Phase 2-a + Phase 2-b の実装を含み、`demo-sig-v1` と
`demo-commit-v1` は ZK 証明ではなく、`hpke-v1` は `node:crypto` による
RFC 9180 base mode です。
仕様にはユースケースの説明と結果束縛フィールド（`outputCommitment` / `nonce` /
`tools/list` 記述子 / `inputAttestations` / 遅延証明）も含まれており、
docs/PLAN.md の Phase 2-b までに実装済みです。なお、デモは `resultId` の principal
binding（認可主体への束縛）を実装していません。期限切れの `resultId` は、
保持された tombstone により期限切れ後 2×TTL の間は `resultExpired` を返し、
その後は `resultNotFound` を返します。デモには認証がないため、principal/session
binding は実装していません。

### Phase 2-b の実 ZK 形式

`add` は次の実 ZK 形式も広告します。`snarkjs-v2` は Circom の 32-bit 加算
回路上の Groth16、`noir-v1` は Noir の checked `u32` 加算上の UltraHonk
です。前者は実際の証明ですが、同梱 proving key は単一参加者のローカル
Powers of Tau による**安全でないデモ専用**の trusted setup を使います。
後者は trusted setup 不要です。`circuitHash` は `verificationKeyUri` で
配信される検証鍵文書の正確なバイト列の SHA-256（`0x` 付き）です。

Circom / Nargo が利用できる環境では `./scripts/build-circuits.sh` で再構築
できます。ローカル Powers of Tau の `.ptau` と中間 zkey はコミットせず、
デモ専用で本番セキュリティには不適切です。ベンチマークは
`npm run bench` で `docs/BENCHMARKS.md` に再生成します。bb.js 5.2.0 は
証明ごとに stdout へ生成状況を一行出力します。

### クイックスタート

```sh
npm install
npm test
npm run demo
```