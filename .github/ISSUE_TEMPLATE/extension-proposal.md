---
name: "Extension proposal"
about: "Propose an extension plan for Phase 2–4 / SEP submission"
title: "[proposal] "
labels: proposal
---

## Summary
(1–3 lines)

## Target Phase
Phase 2 / 3 / 4 / SEP submission / cross-cutting (§7 open question N)

## Consistency with the §2 design principles (Step 0 table)

## Impact on the spec (docs/spec/verifiable-tools.md)
- None / additive / breaking change (identifier update required: SEP-2133 "Breaking changes MUST use a new identifier")
- Affected sections: ...

## Implementation plan
- Affected packages: packages/protocol | prover | verifier | server | client
- Tests to add / change (tests/*.test.ts, mapped to the Testing Plan)
- fixtures to add under examples/

## MCP extension-governance position
- Identifier: `io.modelcontextprotocol/verifiable-tools` (after SEP acceptance) / `io.github.ripple-node-lab/verifiable-tools` (third-party implementation pre-acceptance) — which is assumed?
- Relevant Working Group / Interest Group
- Contribution to the SEP-2133 requirements (RFC 2119 vocabulary, reference implementation in an official SDK)

## Acceptance criteria
- [ ] `npm run build && npm test` passes
- [ ] The README disclaimer (not cryptographically ZK, etc.) is updated
- [ ] docs/PLAN.md §5 / §6 / §7 and docs/spec/verifiable-tools.md are in sync
