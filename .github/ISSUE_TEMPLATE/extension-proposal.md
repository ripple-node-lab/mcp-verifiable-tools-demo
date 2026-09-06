---
name: "Extension proposal"
about: "Phase 2〜4 / SEP 提出に向けた拡張プランの提案"
title: "[proposal] "
labels: proposal
---

## 概要
（1〜3 行）

## 対象 Phase
Phase 2 / 3 / 4 / SEP 提出 / 横断（§7 未決事項 N 番）

## §2 設計方針との整合（Step 0 の表）

## 仕様（docs/spec/verifiable-tools.md / .ja.md）への影響
- 変更なし / 追記 / 破壊的変更（識別子の更新が必要: SEP-2133「Breaking changes MUST use a new identifier」）
- 影響する節: ...

## 実装計画
- 影響パッケージ: packages/protocol | prover | verifier | server | client
- 追加 / 変更するテスト（tests/*.test.ts、Testing Plan との対応）
- examples/ への fixture 追加

## MCP 拡張ガバナンス上の位置づけ
- 識別子: `io.modelcontextprotocol/verifiable-tools`（SEP 受諾後）/ `com.ripple-node-lab/verifiable-tools`（受諾前の第三者実装）のどちらを前提にするか
- 関連 Working Group / Interest Group
- SEP-2133 の要件（RFC 2119 語彙、公式 SDK での参照実装）への寄与

## 受け入れ基準
- [ ] `npm run build && npm test` が通る
- [ ] README の免責（暗号学的 ZK ではない等）が更新されている
- [ ] docs/PLAN.md §5 / §6 / §7 と docs/spec/verifiable-tools.md / .ja.md（英日）が同期されている
