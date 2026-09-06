# デモ構成プラン / Demo Plan

対象仕様: [`docs/spec/verifiable-tools.md`](spec/verifiable-tools.md)（英語 / SEP 提出用）、[`docs/spec/verifiable-tools.ja.md`](spec/verifiable-tools.ja.md)（日本語）
関連 issue: https://github.com/zk-tokyo/advanced-cryptography-2026/issues/94

## 1. 目的

MCP SEP ガイドラインの「Prototype Requirements」と設計原則「Demonstration over deliberation / Pragmatism over purity」に従い、
`io.modelcontextprotocol/verifiable-tools` 拡張が **MCP 2026-07-28 上で実際に動くこと** をレビュアーが `npm install && npm test` だけで確認できるようにする。

デモが示すこと:

1. `server/discover` での capability 宣言と、リクエスト単位 `_meta` による拡張ネゴシエーション
2. `tools/call` 結果の `_meta["io.modelcontextprotocol/verifiable-tools"]` に証明メタデータを載せ、クライアントがローカル検証できること
3. `io.modelcontextprotocol/tasks` 拡張を使った非同期証明生成（`resultType: "task"` → `tasks/get`）
4. `verifiable-tools/call` によるブラインド実行（暗号化引数 + `inputCommitment`）
5. 仕様の Testing Plan に挙げた否定テスト（不正証明、`circuitHash` 不一致、未宣言 `proofFormat`、不正なブラインド入力、拡張未ネゴシエーション時の無視）

## 2. 設計方針（Pragmatism over purity）

- **プロトコル層を主役にする。** 本拡張の本質は「証明をどう運ぶか」であり、特定の ZK エンジンではない。証明バックエンドは `Prover` / `Verifier` インターフェースの背後に置き、差し替え可能にする。
- **Phase 1 は依存ゼロで動く証明形式を使う。** ezkl / risc0 / snarkjs は環境構築が重く「Be runnable by reviewers」に反するため、Node 標準 `crypto` のみで検証できる 2 形式をまず実装する。
  - `demo-sig-v1`: 「TEE Attestation 相当」のシミュレーション。Prover が `circuitHash || inputCommitment || outputHash` を Ed25519 署名する。`verificationKeyUri` から公開鍵を取得して検証する。
  - `demo-commit-v1`: 「ZK 証明相当」のシミュレーション。`publicInputs = [output, inputCommitment]`、`proof = SHA-256(circuitHash || publicInputs)`。証明としての健全性は無いが、フィールドの流れ（`publicInputs` / `circuitHash` / `verificationKeyUri`）を確認できる。
  - README で **これらは暗号学的な ZK ではないこと** を明記する。
- **Phase 2 で実エンジンを追加する。** `snarkjs-v2`（Groth16, 小さな circom 回路の事前コンパイル済み `wasm` / `zkey` / `vk.json` を同梱）を最初の実 ZK バックエンドとし、`ezkl-v1` / `risc0-v1` はアダプタの雛形と手順のみ置く。
- **SDK 依存を避ける。** 公式 SDK の 2026-07-28 対応状況に左右されないよう、JSON-RPC 2.0 + Streamable HTTP（POST のみ）を薄く自前実装する。将来 `typescript-sdk` の Extension API に載せ替えられるよう、プロトコル処理は `packages/protocol` に隔離する。

## 3. リポジトリ構成

```text
mcp-verifiable-tools-demo/
├── README.md                     # セットアップ手順、拡張識別子、対応 proofFormat、免責
├── docs/
│   ├── PLAN.md                   # 本ドキュメント
│   └── spec/
│       ├── verifiable-tools.md      # SEP 草案（英語）
│       └── verifiable-tools.ja.md   # SEP 草案（日本語）
├── package.json                  # npm workspaces
├── tsconfig.base.json
├── packages/
│   ├── protocol/                 # 拡張の型・定数・_meta ヘルパー（SDK 非依存）
│   │   └── src/
│   │       ├── constants.ts      # EXTENSION_ID, TASKS_EXTENSION_ID, PROTOCOL_VERSION, META キー
│   │       ├── types.ts          # VerifiableToolsCapability, VerifiableToolsMeta, VerifiableCallParams ...
│   │       ├── meta.ts           # clientCapabilities 生成 / 抽出、ネゴシエーション判定（proofFormats の交差）
│   │       └── index.ts
│   ├── prover/                   # 証明バックエンド（サーバー側）
│   │   └── src/
│   │       ├── prover.ts         # interface Prover { format; prove(input) }
│   │       ├── demo-sig.ts       # demo-sig-v1（Ed25519）
│   │       ├── demo-commit.ts    # demo-commit-v1（SHA-256）
│   │       └── index.ts
│   ├── verifier/                 # 証明検証（クライアント側）
│   │   └── src/
│   │       ├── verifier.ts       # interface Verifier { format; verify(meta, ctx) }
│   │       ├── demo-sig.ts
│   │       ├── demo-commit.ts
│   │       ├── registry.ts       # verificationKeyUri → 公開鍵の取得と circuitHash ごとのピン留め
│   │       └── index.ts
│   ├── server/                   # MCP 2026-07-28 Streamable HTTP サーバー
│   │   └── src/
│   │       ├── http.ts           # POST /mcp, MCP-Protocol-Version / Mcp-Method / Mcp-Name 検査
│   │       ├── discover.ts       # server/discover
│   │       ├── tools.ts          # tools/list, tools/call（同期 / タスク）
│   │       ├── tasks.ts          # tasks/get, tasks/cancel（インメモリタスクストア）
│   │       ├── blind.ts          # verifiable-tools/call（復号 → 実行 → 証明）
│   │       ├── tools/
│   │       │   ├── add.ts        # add(a, b): 同期証明
│   │       │   ├── riskScore.ts  # riskScore(symbol): 遅延付き非同期証明（tasks）
│   │       │   └── creditCheck.ts# privateCreditCheck: ブラインド専用
│   │       └── main.ts           # `npm run server`
│   └── client/                   # 検証クライアント
│       └── src/
│           ├── client.ts         # discover → capability 交差 → tools/call → verify
│           ├── tasks.ts          # pollIntervalMs に従う tasks/get ポーリング
│           ├── blind.ts          # 引数暗号化 + inputCommitment 生成 → verifiable-tools/call
│           └── main.ts           # `npm run demo` で 3 シナリオを順に実行
├── examples/                     # 仕様書と同じ JSON メッセージのサンプル（fixture としてテストでも使用）
│   ├── discover.json
│   ├── tools-call.request.json
│   ├── tools-call.result.json
│   ├── tools-call.task.json
│   ├── tasks-get.request.json
│   └── verifiable-tools-call.request.json
├── tests/                        # node:test（統合テスト）
│   ├── negotiation.test.ts
│   ├── sync-proof.test.ts
│   ├── async-tasks.test.ts
│   ├── blind-call.test.ts
│   └── negative.test.ts
└── .github/workflows/ci.yml      # npm ci && npm run build && npm test
```

## 4. 各コンポーネントの仕様

### 4.1 サーバー（`packages/server`）

- `POST /mcp` のみ。`Content-Type: application/json`。
- 必須ヘッダー検査: `MCP-Protocol-Version: 2026-07-28`、`Mcp-Method` が JSON-RPC の `method` と一致、`tools/call` では `Mcp-Name` が `params.name` と一致。不一致は JSON-RPC `-32600 Invalid Request`。
- 各リクエストの `params._meta["io.modelcontextprotocol/clientCapabilities"]` から拡張宣言を読む（ステートレス。セッション ID は使わない）。
- `server/discover` 応答は仕様書 §5 の例と同一形式（`proofFormats: ["demo-sig-v1", "demo-commit-v1"]`, `blindExecution: true`, `io.modelcontextprotocol/tasks: {}`）。
- `tools/call`:
  - クライアントが本拡張を宣言していなければ **通常の `CallToolResult` のみ**（`_meta` に拡張キーを付けない）。
  - 宣言していれば `proofFormats` の交差から 1 形式を選ぶ（`_meta["io.modelcontextprotocol/verifiable-tools"].requestedProofFormat` を優先）。交差が空で `requireProof: true` なら `-32602` 相当のエラー、そうでなければ証明なしで返す。
  - `riskScore` はクライアントが `io.modelcontextprotocol/tasks` を宣言している場合のみ `resultType: "task"` を返す（未宣言なら同期で待って返す）。
- `tasks/get` / `tasks/cancel`: SEP-2663 の `Task` 形状（`taskId`, `status`, `createdAt`, `lastUpdatedAt`, `ttlMs`, `pollIntervalMs`）。完了時は `result` に `CallToolResult` + 拡張 `_meta` を含める。
- `verifiable-tools/call`: `encryptionScheme: "x25519-aesgcm-demo-v1"`（HPKE の簡易代替。README で明記）。サーバーの X25519 公開鍵は `server/discover` の拡張 capability に `blindPublicKey` として載せる（デモ用フィールド、仕様書では未定義であることを注記）。復号後に `SHA-256(canonical JSON(args))` が `inputCommitment` と一致することを確認、不一致は `-32602`。応答 `_meta` には `inputCommitment` を含める。
- `GET /vk/{circuitHash}`: `verificationKeyUri` の実体。`demo-sig-v1` の Ed25519 公開鍵（PEM）を返す。

### 4.2 クライアント（`packages/client`）

1. `server/discover` → サーバーの `proofFormats` と自分の対応形式を交差。
2. `tools/call add` → 同期結果 → `verifier.verify()`。
3. `tools/call riskScore` → `resultType: "task"` → `pollIntervalMs` 間隔で `tasks/get` → `completed` → 検証。
4. `verifiable-tools/call privateCreditCheck` → 暗号化 + コミットメント → 応答の `inputCommitment` が自分の計算値と一致し、署名が有効であることを確認。
5. 検証失敗時は結果を使用せず非ゼロ終了（仕様書「A client MUST NOT act on a tool result whose proof fails verification」）。

### 4.3 テスト（`tests/`、`node --test`）

| ファイル | 検証内容 |
|---|---|
| `negotiation.test.ts` | 拡張未宣言 → `_meta` に拡張キーなし / 宣言 → あり / 交差空 + `requireProof` → エラー |
| `sync-proof.test.ts` | `add` の証明が両形式で検証成功、`publicInputs[0]` が `content[0].text` と一致 |
| `async-tasks.test.ts` | `tasks` 未宣言 → 同期完了 / 宣言 → `resultType: "task"` → ポーリングで完了し検証成功 |
| `blind-call.test.ts` | 正常系、`Mcp-Name` 無しで受理されること、サーバーログに平文が出ないこと |
| `negative.test.ts` | 改ざん `proof`、`circuitHash` 不一致、未宣言 `proofFormat`、`inputCommitment` 不一致、`Mcp-Method` 不一致 |

## 5. 実装フェーズ

| Phase | 内容 | 成果物 |
|---|---|---|
| 1（本 PR） | 上記構成の雛形 + `demo-sig-v1` / `demo-commit-v1` + 3 シナリオ + テスト + CI | `npm run demo` / `npm test` が通る |
| 2 | `snarkjs-v2` バックエンド（circom `add` 回路を事前コンパイルして同梱）、`proofUri` の利用例 | 実 ZK 証明が 1 形式動く |
| 3 | `ezkl-v1` / `risc0-v1` アダプタ雛形、Docker 化した TEE 風実行環境（`teeAttestation` に実 attestation 形式を入れる） | SEP 本文 Reference Implementation 節へのリンク |
| 4 | `modelcontextprotocol/typescript-sdk` の Extension API へ移植し、SEP-2133 が求める「公式 SDK での参照実装」を満たす | SDK フォーク/ブランチ |
| SEP 提出 | `docs/spec/verifiable-tools.md` の Reference Implementation 節に本リポジトリと SDK 実装へのリンクを追記し、`modelcontextprotocol/modelcontextprotocol` に SEP PR を提出 | SEP PR |

## 6. 仕様との対応表

| 仕様書節 | デモでの実装箇所 |
|---|---|
| Extension identifier / Capability object | `packages/protocol/src/constants.ts`, `packages/server/src/discover.ts` |
| Request metadata / HTTP headers | `packages/protocol/src/meta.ts`, `packages/server/src/http.ts` |
| Verifiable tool result (`_meta` フィールド) | `packages/protocol/src/types.ts`, `packages/prover/*` |
| Asynchronous proof generation via Tasks | `packages/server/src/tasks.ts`, `packages/client/src/tasks.ts` |
| Blind / committed-input tool calls | `packages/server/src/blind.ts`, `packages/client/src/blind.ts` |
| Verification flow | `packages/verifier/*`, `packages/client/src/client.ts` |
| Security Implications（VK ピン留め、形式の交差） | `packages/verifier/src/registry.ts`, `packages/protocol/src/meta.ts` |
| Testing Plan | `tests/*` |

## 7. 未決事項

- `blindPublicKey` のような鍵配布フィールドを仕様書に追加するか（現状はデモ用フィールドとして扱う）。
- `proofFormat` 文字列のレジストリをどう扱うか（仕様書 Open Questions と同じ）。
- Phase 4 の SDK 移植先を TypeScript SDK にするか Python SDK にするか。
- 公式化前の拡張識別子: 現状は `io.modelcontextprotocol/verifiable-tools` を使用しているが、SEP 受諾前の第三者実装は vendor prefix（例 `com.ripple-node-lab/verifiable-tools`）を使うべき。受諾されなかった場合は識別子を切り替える。
- クライアント側の tool→circuitHash の信頼できる配布方法（現状はデモ用に protocol パッケージへ固定）。
- `tasks/cancel` は状態のみ変更し producer を停止しない（実バックエンドでは cancellation token が必要、Phase 2 で対応）。
- SEP 受諾前に MCP org 内の experimental extension（`experimental-ext-*`、WG/IG 紐付け必須）として incubation を行うか。

## 8. 拡張プラン提出手順

拡張プランの提出は [issue #2](https://github.com/ripple-node-lab/mcp-verifiable-tools-demo/issues/2) の手順に従い、`.github/ISSUE_TEMPLATE/extension-proposal.md` のテンプレートを使用する。

- Step 0: §2 設計方針との整合チェックを行い、逸脱する場合は理由を記載する。
- Step 1: `proposal` ラベルでテンプレートを使い、Discussion issue（1 提案 = 1 issue）を作成する。
- Step 2: 合意形成後、`accepted` / `needs-revision` / `rejected` ラベルで状態を更新する。
- Step 3: PR に `Closes #<proposal issue>` を含め、`docs/PLAN.md` と仕様（英日）を同期する。
- Step 4: Phase 完了時に成果物を確認し、SEP-2133 対応（公式 SDK 参照実装・SEP 提出）へ進む。
