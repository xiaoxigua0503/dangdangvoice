# Enterprise report scope v2 — local follow-up

> Superseded by [claim-level v3 verification](./README-ENTERPRISE-CLAIMS-V3.md): a separate copy of the saved listings produced four accepted real Qwen remarks with explicit partial status in one request. The quota-blocked v2 result below is historical.

## Contract

New model output contains only `title`, `competitors`, `sections`, `checks`.
`scope` is absent from the model schema and explicitly excluded by the report-only
prompt. Model-supplied scope is rejected rather than silently dropped.

After schema, source, listing coverage and numeric validation succeed, backend
adds `reportVersion: 2` and a legacy-compatible `scope` claim. Its text and fact
references come from `snapshot.coverage`, `snapshot.statistics` and actual missing
listing fields; `generatedBy: backend` records its provenance. Model claims cannot
supply these counts or override scope. The existing UI renders the saved shape
without migration. Historical reports are read as saved, without revalidation,
regeneration or changing their scope.

Report parser normalizes numbering prefixes only in report title/section headings,
while preserving exact source names. Analysis text is not rewritten. Exact cited
product names retain their existing whitelist check; invented numbers, prices,
percentages, references outside the snapshot, incomplete competitor mappings and
cross-listing competitor sources remain rejected. The outgoing report schema also
instructs qualitative analysis through a lexical pattern; backend semantic
validation still permits exact, attributable numeric names. Enterprise DiDi's
prompt, schema and validation branch are unchanged.

## Prior production-provider diagnosis

Read directly from local Docker PostgreSQL before editing:

- `3cbf8c4f-8d05-462b-b902-6ee807da0138`: failed,
  `numeric_narrative_not_allowed`, validation, `scope.text`.
- `e0d93615-04da-4ec9-89f2-31cdc7c9f3aa`: failed,
  `numeric_narrative_not_allowed`, validation,
  **`sections[0].claims[0].text`**.

The rejected candidate text was not persisted, so its exact offending phrase
cannot be reconstructed. The section fixture reproduces the diagnosed field path
with a synthetic invented price; it is not presented as the actual Qwen text.
No rule was weakened based on a guess about that phrase.

## Offline verification

Passed:

- [report checks](./scripts/check-enterprise-report.mjs): stored two-listing fixture,
  backend scope and missing fields, no scope in outgoing schema, numeric/heading
  cases, exact source names, rejected invented prices/counts/ratios, fake IDs,
  both required competitor rows and legacy stored shape.
- [report UI checks](./scripts/check-enterprise-report-browser.mjs): new backend
  scope 2/2, source viewer for each listing, old scope still readable, refresh
  without POST, stopped terminal polling, desktop/mobile without overflow.
- [pure Enterprise checks](./scripts/check-enterprise.mjs),
  [access fixtures](./scripts/check-enterprise-access.mjs), isolated Docker
  [PostgreSQL checks](./scripts/check-enterprise-db.mjs), typecheck, build.

Worker remained off throughout offline checks. Test database is separate from the
existing application data. No crawling, production access or paid inference was
performed.

## Real local verification is blocked by the existing daily cap

Batch `e6ff547b-5ddb-41dc-9d1a-d12c403778b0` already has **five reports in 24 hours**.
The existing daily limit has been preserved. An actual click on the local UI
returned HTTP 429, `本批次今日报告请求已达上限`, before creating a report or dispatching
a model request. No task/snapshot/history was removed, rewritten or backdated to
get around that limit.

- New real Qwen requests in this follow-up: **0**.
- New real task/report URL: **none**; no completed v2 report is claimed.
- Local batch UI:
  http://localhost:3001/enterprise?research=e6ff547b-5ddb-41dc-9d1a-d12c403778b0
- Web was started on port 3001 against Docker local PostgreSQL; report worker
  remains stopped.
- A clarification was requested about either waiting for the existing quota
  window or authorizing exactly one local verification exception. No exception
  was implemented or consumed without an answer.

The one-request real end-to-end step must still be completed after that blocker
is resolved. The previous failed task remains readable at:
http://localhost:3001/enterprise?research=e6ff547b-5ddb-41dc-9d1a-d12c403778b0&enterpriseReport=e0d93615-04da-4ec9-89f2-31cdc7c9f3aa

## Files changed in this follow-up

- [server/enterprise-context.mjs](./server/enterprise-context.mjs)
- [server/enterprise-worker.mjs](./server/enterprise-worker.mjs) — report mock output
- [scripts/check-enterprise-report.mjs](./scripts/check-enterprise-report.mjs)
- [scripts/check-enterprise.mjs](./scripts/check-enterprise.mjs)
- [scripts/check-enterprise-db.mjs](./scripts/check-enterprise-db.mjs)
- [scripts/check-enterprise-report-browser.mjs](./scripts/check-enterprise-report-browser.mjs)
- [stored-batch.json](./tests/fixtures/enterprise-report/stored-batch.json) — public
  product metadata/observations from the saved batch; no prompt/provider body,
  key, account cookie or personal review data.

No UI renderer change or migration was necessary for the compatible saved scope
shape. Prior uncommitted work was retained. No deployment, Neon/VM access, model
configuration change or historical snapshot edit occurred.
