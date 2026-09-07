# MCP Verifiable Tools Demo

This repository is a Phase 1 + Phase 2-a + Phase 2-b + Phase 3 (a–d) + Phase 4-a (SDK adapter) reference
demo for the `io.modelcontextprotocol/verifiable-tools` extension on MCP
`2026-07-28`. It demonstrates capability negotiation, locally verified tool
results, asynchronous proof generation through Tasks, blind committed-input
calls, real Groth16/UltraHonk ZK proofs (`snarkjs-v2` / `noir-v1`), a
verifiable TEE attestation format (`tee-nitro-v1`), and HTTP sidecar
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

`risc0-v1` (Phase 3-b) is a real RISC Zero zkVM format: proving runs in the
Rust `sidecars/risc0` sidecar (`docker compose --profile risc0 up --build -d
--wait`, then `RISC0_SIDECAR_URL=http://127.0.0.1:4200 ...`), while
verification runs in-process in a 1.5 MB WASM build of `risc0-zkvm`
(`packages/prover-risc0`) — generate on Rust, verify in TS. Composite
receipts are ~222 KB and take ~40–60 s to prove on CPU; the demo's scenario 8
runs only when `RISC0_SIDECAR_URL` is set.

`ezkl-v1` (Phase 3-c) is a real ZKML format: proving runs in the Python
`sidecars/ezkl` sidecar (`docker compose --profile ezkl up --build -d
--wait`, then `EZKL_SIDECAR_URL=http://127.0.0.1:4300 ...`), while
verification runs in-process via the `@ezkljs/engine` 22.0.1 WASM build
(`packages/prover-ezkl`) — generate on Python, verify in TS. Proofs are
~20 KB and take ~2–3 s to produce; the demo's scenario 9 runs only when
`EZKL_SIDECAR_URL` is set. `ezkl-v1` restricts `add` inputs to
`0..2^24` — ONNX FLOAT ingest is only exact below 2^24 and the circuit's
range-check decomposition caps at 2^28 (see `parseEzklAddArguments`).

## Input provenance (Phase 3-d)

Tools that consume external data advertise `externalInputs` in their
`tools/list` descriptor and attach `inputAttestations` to the proof meta;
each attestation's `commitment` (`sha256(data)`) is appended to
`publicInputs` and covered by the proof signature/commitment, and clients
declaring `requireInputProvenance` reject results without valid
attestations (`provenanceMissing` / `provenanceMalformed` / `provenanceUnbound`
/ `provenanceUnsupported` / `provenanceInvalid`). `riskScore` prices a
symbol via a `PriceFeed`: by default the in-process `OraclePriceFeed`
issues `oracle-sig-v1` attestations (ed25519 over `jcs({type, source,
commitment})`, key pinned at `/oracle-keys/demo`); with `TLSN_SIDECAR_URL`
(`docker compose --profile tlsn up --build -d --wait`, then
`TLSN_SIDECAR_URL=http://127.0.0.1:4400 ...`) the Rust `sidecars/tlsn`
sidecar issues `zktls-tlsn-v1` TLSNotary attestations instead — fixture
exchange + in-process notary + prover in one binary, ~1 s per attestation,
~5.3 KB presentation, secp256k1 notary key fetched via the
origin-allowlisted key registry. Presentation verification runs in the
sidecar because `tlsn-core` does not build for bare wasm32 (`getrandom`);
the demo's scenario 10 runs only when `TLSN_SIDECAR_URL` is set.

## SDK adapter (Phase 4-a)

`packages/sdk-extension` bridges the extension onto the published
`@modelcontextprotocol/sdk@1.30.0` (`zod` pinned to `4.5.4`): the SDK owns
the transport and `initialize` handshake while `DemoServer.dispatch` keeps
all extension semantics. A `DemoServer` still `listen()`s for the `/vk/*`
and `/oracle-keys/*` HTTP endpoints; only JSON-RPC moves onto the SDK
transport.

```ts
import { createVerifiableServer, createVerifiableClient, verifiableClientCapabilities } from "@demo/sdk-extension";

const demo = new DemoServer();
await demo.listen(3000);
const server = createVerifiableServer(demo);          // Server with registered
                                                      // capabilities.extensions + handlers
await server.connect(/* any SDK transport */);

const capability = { proofFormats: ["demo-sig-v1"], requireInputProvenance: true, tasks: true };
const client = new Client({ name: "app", version: "1.0.0" }, {
  capabilities: verifiableClientCapabilities(capability)
});
await client.connect(/* peer transport */);
const verifiable = createVerifiableClient(client, demo.url, capability); // same
   // capability value feeds initialize and the per-request _meta; throws if the
   // server did not advertise io.modelcontextprotocol/verifiable-tools
await verifiable.callAndVerify("add", { a: 20, b: 22 }, "demo-sig-v1");
```

Known gaps against the 2026-07-28 wire: SDK 1.x negotiates `2025-11-25` at
`initialize` (the 2026-07-28 revision is only in the unpublished v2 alpha),
`Mcp-Method`/`Mcp-Name` header enforcement is SDK-transport specific and not
applied on this path, `tasks/*` are carried as extension custom methods
rather than the SDK's experimental tasks surface, and SDK 1.30.0's stateless
Streamable HTTP mode rejects the post-initialize notification (tests use
stateful sessions).

## Repository layout

- `packages/protocol`: extension constants, types, metadata, negotiation, and
  minimal CBOR (RFC 8949) / COSE_Sign1 (RFC 9052) codecs.
- `packages/prover`: Ed25519 signature, SHA-256 commitment, and `tee-nitro-v1`
  (mock-attested COSE_Sign1) demo provers.
- `packages/prover-snarkjs`: Circom/Groth16 `snarkjs-v2` prover and verifier.
- `packages/prover-noir`: Noir/UltraHonk `noir-v1` prover and verifier.
- `packages/verifier`: local verifiers, verification-key pinning, the
  `tee-nitro-v1` attestation verifier, and `provenance.ts`
  (`verifyProvenance`, `ProvenanceVerifier`, `OracleSigVerifier`).
- `packages/server`: Streamable HTTP MCP server, demo tools, and
  `pricefeed.ts` (`OraclePriceFeed` in-process, `TlsnPriceFeed` via the
  tlsn sidecar).
- `packages/client`: verifying client and ten-scenario demo.
- `packages/prover-risc0`: `risc0-v1` verifier (WASM build of `risc0-zkvm`).
- `packages/prover-ezkl`: `ezkl-v1` verifier (`@ezkljs/engine` WASM) and the
  committed `add` circuit artifacts (onnx / settings / vk / SRS).
- `packages/prover-sidecar`: HTTP sidecar contract adapter (`SidecarProver`,
  `SidecarVerifier`, `sidecarHealth`) plus `TlsnProvenanceVerifier` for
  `zktls-tlsn-v1` attestations.
- `packages/sdk-extension`: adapter onto `@modelcontextprotocol/sdk@1.30.0`
  (`attachVerifiableTools`/`createVerifiableServer`, `sdkRpc`/`createVerifiableClient`,
  `verifiableClientCapabilities`, `assertServerSupportsVerifiableTools`).
- `packages/sidecar-mock`: reference sidecar implementing `demo-sig-sidecar-v1`.
- `sidecars`: sidecar README, mock + risc0 + ezkl + tlsn Dockerfiles, Nitro mock
  fixtures, risc0 Rust workspace, wasm verifier source, ezkl sidecar + proof
  fixtures, tlsn Rust sidecar.
- `examples`: representative JSON-RPC messages.
- `tests`: deterministic `node:test` integration tests.

Further reading: [English specification](docs/spec/verifiable-tools.md),
[Japanese specification](docs/spec/verifiable-tools.ja.md), and
[the implementation plan](docs/PLAN.md). Discussion and tracking live in
[issue #94](https://github.com/zk-tokyo/advanced-cryptography-2026/issues/94).
The specification now includes use-case narrative and result-binding fields
(`outputCommitment` / `nonce` / `tools/list` descriptors / `inputAttestations` /
deferred proofs), implemented here through Phase 4-a of [docs/PLAN.md](docs/PLAN.md).
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

Both ZK profiles require `a`, `b`, and the checked `u32` sum `a + b` to be in
`[0, 2^32 - 1]`; overflowing or otherwise invalid arguments are rejected with
`-32602`.

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
After changing a circuit, rebuild the artifacts first; the rebuild regenerates
the Noir verification-key document and updates the pinned hashes. Then run
`npm run build && npm test` to verify the generated artifacts and pins.

## 日本語

### 概要

MCP `2026-07-28` 上で `io.modelcontextprotocol/verifiable-tools` 拡張の
ネゴシエーション、証明メタデータのローカル検証、Tasks による非同期処理、
暗号化した引数によるブラインド実行、実 ZK 証明（`snarkjs-v2` Groth16 /
`noir-v1` UltraHonk、RISC Zero zkVM の `risc0-v1` は Rust sidecar 経由）、
`tee-nitro-v1` attestation、HTTP sidecar 合成を示すデモです。
Phase 1 + Phase 2-a + Phase 2-b + Phase 3-a〜d の実装を含み、`demo-sig-v1` と
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

`risc0-v1`（Phase 3-b）は prove を Rust sidecar、検証を in-process WASM
（`packages/prover-risc0`）で行う実 zkVM 形式です（「生成は他言語、検証は
TS」）。`RISC0_SIDECAR_URL` 指定時のみデモのシナリオ 8 が動きます。
`ezkl-v1`（Phase 3-c）は prove を Python `ezkl` sidecar（`docker compose
--profile ezkl`）、検証を `@ezkljs/engine` の WASM で in-process に行う
実 ZKML 形式です（`packages/prover-ezkl`）。`EZKL_SIDECAR_URL` 指定時のみ
デモのシナリオ 9 が動きます。`ezkl-v1` は `add` の入力を `0..2^24` に
制限します（ONNX FLOAT 入力は 2^24 未満でのみ厳密、回路の range-check
分解は 2^28 が上限 — `parseEzklAddArguments` 参照）。

Phase 3-d は入力プルーベナンスを追加します: `externalInputs` ツールは
`inputAttestations` を証明に付し、各コミットメント（`sha256(data)`）を
`publicInputs` 末尾に束縛します。`requireInputProvenance` を宣言した
クライアントは妥当な attestation の無い結果を拒否します。`riskScore`
は価格を `PriceFeed` から取得し、既定では in-process `OraclePriceFeed`
の `oracle-sig-v1` attestation（ed25519、`/oracle-keys/demo` で鍵配布）、
`TLSN_SIDECAR_URL` 指定時は `sidecars/tlsn` の `zktls-tlsn-v1`
（TLSNotary）attestation を使います（デモ シナリオ 10）。`tlsn-core` は
bare wasm32 では `getrandom` のためビルドできないため、Presentation 検証は
Rust sidecar に委譲し、notary 鍵は registry でピン留めします。

Phase 4-a は `packages/sdk-extension` で公開版 `@modelcontextprotocol/sdk`
1.30.0（zod 4.5.4 ピン）へのアダプタを提供します: SDK が transport と
`initialize` ハンドシェイクを担い、拡張の意味論は `DemoServer.dispatch` が
保持します。サーバー側は `createVerifiableServer`（initialize の
`capabilities.extensions` に拡張を広告 + 各メソッドを dispatch へ委譲）、
クライアント側は `createVerifiableClient`（拡張を広告しないサーバーでは
初期化時に失敗）。既知の差分: SDK 1.x の initialize は 2025-11-25 を
ネゴシエートし（2026-07-28 は v1.x 未公開）、`Mcp-Method`/`Mcp-Name`
ヘッダ検査は SDK transport では行われず、tasks は拡張の custom method
として動かします（stateless Streamable HTTP は SDK 1.30.0 の既知問題で
post-initialize 通知を 500 で落とすため stateful session を使用）。

仕様にはユースケースの説明と結果束縛フィールド（`outputCommitment` / `nonce` /
`tools/list` 記述子 / `inputAttestations` / 遅延証明）も含まれており、
docs/PLAN.md の Phase 4-a までに実装済みです。なお、デモは `resultId` の principal
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
両形式とも `a`、`b`、および checked `u32` の和 `a + b` は
`[0, 2^32 - 1]` に収まらなければならず、オーバーフローや不正な引数は
`-32602` で拒否されます。

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