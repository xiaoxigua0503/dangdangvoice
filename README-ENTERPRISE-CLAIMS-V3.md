# Enterprise claim-level reports — verified locally

## Real result

A single real `qwen3.8-flash` request produced **four accepted remarks** and six
rejected remarks. The UI displays the accepted text and working source buttons,
and explicitly reports **AI 分析部分可用**, rather than claiming all AI output passed.

- Local report:
  http://localhost:3001/enterprise?research=7fc5774f-61ea-4ad6-aaab-43730e8e30e2&enterpriseReport=33afe10a-0bc0-422b-9d29-a0aa02d51a7a
- Test batch: `7fc5774f-61ea-4ad6-aaab-43730e8e30e2`.
- Task: `33afe10a-0bc0-422b-9d29-a0aa02d51a7a`.
- Task state: `completed` (processing ended and result saved).
- Result: `reportVersion=3`, `aiStatus=partial`, accepted=4, rejected=6.
- Model: `qwen3.8-flash`; provider request count=1; provider attempt count=1;
  usage.mock=false. No model/endpoint/key change or fallback request.
- Web remains on localhost:3001. The verification worker was stopped after this
  one task, including after the UI/source/refresh checks.

The test batch was explicitly labelled `本地验证 · 已保存双商品（不重新采集）` and
copied only the two already-saved listings from
`e6ff547b-5ddb-41dc-9d1a-d12c403778b0`. There were **zero collection tasks** in the
new batch and no product/comment crawl. The original batch, listing data/states,
all original snapshot documents, task inputs/states and provider counters were
compared against a pre-run baseline: **zero changes**. The original batch's daily
cap was preserved; the test batch uses the same normal cap, without an exception.

## Contract and partial validation

Qwen receives the existing owned immutable snapshot and returns only:

```text
{ sections: [{ heading, claims: [...] }], checks: [...] }
```

Each claim has qualitative `text`, `topic`, `evidenceState`, and `sourceIds` and/or
`statIds`. Omitted reference arrays normalize to empty arrays; at least one actual
reference is required. The server never substitutes a reference or removes an
invalid reference from a claim to force it through.

Each claim is parsed and checked independently for:

- bounded structure/text, supported topic/evidence type;
- forbidden numeric assertions, with exact attributable product-name exemptions;
- references belonging to this snapshot and suitable field/fact type;
- missing-data versus observed-data claims.

A failed claim is omitted intact. Only its original field path and safe error
code are retained in `validation.issues`; rejected text/provider bodies are not
logged or saved in the public result. No sentence rewriting or repair inference
is performed. Malformed top-level JSON/envelope, output truncation or HTTP errors
remain task failures; their snapshot/source table can still be opened.

Backend supplies scope, report title, and comparison listing identities from the
snapshot. The comparison table renders all snapshot products directly, with
original titles, ISBNs, prices and unknown values; it is independent of accepted
AI claims. No claim has to survive for the source table to remain available.

Persisted analysis states are:

| aiStatus | Meaning / UI |
|---|---|
| complete | All returned claims passed and at least one exists |
| partial | Some claims passed; rejected claims omitted and count disclosed |
| unavailable | No claim passed; source table remains, UI says AI 分析尚未完成 |

The durable job may be `completed` while `aiStatus` is partial or unavailable:
that state means request processing is terminal, not that the AI analysis passed
in full. Both the report view and history labels distinguish these states. Empty
analysis cannot open a new Enterprise DiDi conversation; existing valid reports
and chat prompts/schema retain their behavior. No migration was needed because
analysis status/diagnostics use the existing result JSON.

Historical report JSON is still read as stored. Compatibility fields `scope`,
`title`, `competitors`, `sections`, `checks` remain in saved v3 results; old reports
are not rewritten or regenerated. The report engine fingerprint changes with the
source by the existing mechanism; web/worker fingerprints matched before dispatch.

## Checks

Offline fixtures include the actual saved two-listing snapshot and a mixed
response with a synthetic invalid price at **sections[0].claims[0].text**, valid
remarks for both listings, and a forged citation. Checks prove that only invalid
remarks are removed, no raw invalid content is displayed, and all-invalid output
still keeps both source rows and scope.

Passed:

- [claim report checks](./scripts/check-enterprise-report.mjs): mixed numeric and
  citation rejection, exact names, full-width/Chinese numeric assertions,
  source-only references, zero-valid fallback and legacy shape.
- [report browser checks](./scripts/check-enterprise-report-browser.mjs): valid
  parts retained, partial/unavailable/legacy states, both listing source viewers,
  source table always present, refresh without POST, terminal polling cleanup,
  desktop/mobile without horizontal overflow.
- [Enterprise checks](./scripts/check-enterprise.mjs) and isolated Docker
  [DB integration checks](./scripts/check-enterprise-db.mjs): partial/unavailable
  result persistence, no chat on unavailable analysis, ownership, idempotency,
  cancellation, entitlement, daily cap and existing history compatibility.
- Typecheck and build.

Real UI verification confirmed:

- a genuine accepted Qwen remark is visible and its reference opens;
- both product source viewers open the matching saved listing URL;
- the snapshot table contains both products and backend scope is 2/2;
- refresh keeps the same report and sends zero POST requests;
- task/attempt/provider counters confirm exactly one real request;
- desktop and 390px mobile layouts do not overflow.

All six real rejected remarks were rejected for `numeric_narrative_not_allowed`,
at the following paths: sections[0].claims[0].text,
sections[1].claims[0].text, sections[1].claims[1].text,
sections[2].claims[0].text, sections[2].claims[1].text, checks[0].text.
Their actual text is not reconstructed or claimed to be correct. Source validation
is not certification of all factual interpretations in the four accepted remarks.

## Changed files in this follow-up

- [server/enterprise-context.mjs](./server/enterprise-context.mjs): report-only
  qualitative schema/prompt, per-claim validation and explicit result status;
  chat validation kept strict and separate.
- [server/enterprise-worker.mjs](./server/enterprise-worker.mjs): mock provider
  output follows the new report contract; existing durable persistence handles
  accepted/partial/empty results without extra inference.
- [server/enterprise-api.mjs](./server/enterprise-api.mjs): prevent chat on a new
  report with no accepted AI analysis.
- [src/Enterprise.tsx](./src/Enterprise.tsx): snapshot comparison heading, actual
  partial/unavailable status, rejected-count notice, empty-analysis message and
  corresponding report history labels.
- [scripts/check-enterprise-report.mjs](./scripts/check-enterprise-report.mjs),
  [scripts/check-enterprise-report-browser.mjs](./scripts/check-enterprise-report-browser.mjs),
  [scripts/check-enterprise.mjs](./scripts/check-enterprise.mjs),
  [scripts/check-enterprise-db.mjs](./scripts/check-enterprise-db.mjs).

Real run artifacts and resolved local configuration are in ignored
`.private/enterprise-claims-v3/`; do not publish the configuration/session files.
Screenshots: `report-1280.png` and `report-390.png`.

No commit, push, deployment, production migration, Neon/VM operation, mail or
additional real model request was performed. Existing uncommitted changes were
preserved.
