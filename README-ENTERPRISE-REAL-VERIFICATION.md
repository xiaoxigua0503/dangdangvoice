# Enterprise real-provider local verification — 2026-11-24

## Outcome: not complete

The requested real AI report could **not** be completed within the authorized two
Qwen requests. Both requests used the existing `qwen3.8-flash` model, endpoint and
key configuration, reached the provider once, returned complete JSON, and were
rejected during validation. Neither is labelled or counted as a completed report.
No mock inference was used for this batch in this verification.

- Batch: `e6ff547b-5ddb-41dc-9d1a-d12c403778b0`, collected links 2/2.
- Prior task preserved: `c5151d80-b400-4bb2-965a-8a3cd2d9b6be`.
- Request one: `3cbf8c4f-8d05-462b-b902-6ee807da0138`, failed at `scope.text`.
- Request two: `e0d93615-04da-4ec9-89f2-31cdc7c9f3aa`, failed at
  `sections[0].claims[0].text`.
- Both: `numeric_narrative_not_allowed`, attempts=1, provider_requests=1,
  actual_model=`qwen3.8-flash`.
- Last report status/source UI:
  http://localhost:3001/enterprise?research=e6ff547b-5ddb-41dc-9d1a-d12c403778b0&enterpriseReport=e0d93615-04da-4ec9-89f2-31cdc7c9f3aa

The earlier task had no field-path diagnostic or rejected candidate content in
PostgreSQL. Its provider attempt contained usage but no validation error; therefore
no specific offending number/name from that earlier response can be asserted.
The new failures persist field paths and usage, without raw provider bodies or
full conversation/output logs. The exact rejected phrases are not retained, so
this check also cannot claim that the remaining numeric match is an invented
statistic rather than an overly restrictive match.

After request one, the report-only prompt was corrected to remove a conflict:
it required collection time in narrative while forbidding narrative digits.
Scope-specific and per-claim schema descriptions now explicitly delegate dates,
counts, prices and numerical specifications to UI facts. This moved the observed
failure from scope to a section claim on request two; it did not establish real
model success. No third request, output repair, dropped sentence, history deletion
or validator bypass was used.

## Local runtime and spending controls

- Docker PostgreSQL on loopback 5432, database `dangdangvoice`; no Neon/VM access.
- Web on http://localhost:3001, using the current checkout.
- One report worker was restarted with the same resolved configuration and
  Enterprise fingerprint as web, verified before each POST from Chromium.
- A temporary local launcher limits work to this existing batch, report tasks
  only, one worker loop, one provider request/attempt per new task. Original
  model/endpoint/key and output limit were retained.
- The existing 5 reports/batch/24h limit was retained. Three previous requests
  plus these two occupy that batch's five report slots; no history was deleted.
- Worker was stopped after the second request to prevent further spending.
  Web remains available; no chat worker was started and no DiDi request was made.
- PostgreSQL comparison confirmed all seven pre-existing snapshots unchanged;
  the original failed task and prior history remain intact.

The private launcher and configuration are under `.private/enterprise-real-check/`.
They contain resolved local configuration and must not be published or printed.
Do not restart paid inference without a new allowance and a concrete diagnosis.
No new migration or production operation was needed.

## Metadata provenance matrix

Legend:

- **S**: stored batch source, captured around 05:10 UTC; preserved. A new report
  snapshot can project an explicit title/previous DOM field into a normalized
  field, with `derivedFrom` and original timestamp, without changing old snapshots.
- **H/C**: actual fresh static HTML GET around 08:21 UTC and output of the corrected
  collector parser. This independent output is saved privately and was **not**
  written over the original batch or historical snapshots.
- **D**: rendered Chromium/network. Both pages showed access verification; no
  product DOM or business callback body was available. No bypass was attempted.

| Group | 30119333 | 24193243 |
|---|---|---|
| Product / ISBN | **S + H/C:** 洪业：清朝开国史（修订版）…当当专享特装版; ISBN **9787513364119** | **S + H/C:** 洪业：清朝开国史（增订版）; ISBN **9787513323802** |
| Edition | Previously null despite title; **new S projection + H/C:** `修订版 / 当当专享特装版`, explicit title labels, title unchanged | Previously null despite title; **new S projection + H/C:** `增订版`, explicit title label |
| Author / translator / publisher / publication | **H/C, missed by old parser:** author `（美）魏斐德`; translators `陈苏镇 薄小莹等`; publisher 新星出版社; `2026年11月` from `.messbox_info`. Still absent in old batch/report source | **H/C, missed by old parser:** author `（美）魏斐德`; translators `陈苏镇 薄小莹 等`; publisher 新星出版社; `2017年03月`. Still absent in old batch/report source |
| Format / packaging | **S DOM extra fields → new projection + H/C:** 16开, 精装, 是否套装=否; paper unknown, gifts unknown | **S DOM extra fields → new projection + H/C:** 16开, 精装, 胶版纸, 是否套装=否; gifts unknown |
| Shop / IDs | **S + H/C script:** shopId=0, ddShopId=258, supId=19640 (separate IDs). **H/C DOM:** 新星出版社当当自营店, store URL `/258`, missed by old parser. **new S title projection:** 当当自营 is a listing declaration; shop name remains null in old-source report | Same three distinct IDs in **S + H/C**. **H/C DOM:** same named store and URL, missed by old parser; store name/self-operated label remain unknown in the old-source report |
| Display / list prices | **S + H/C:** 168 / 168 CNY from separate `#dd-price` and `#original-price` nodes. **H/C labels:** 当当价 / 定价 from `#dd-price-text` and `#original-price-text`; old parser missed labels | **S + H/C:** 118 / 118 CNY from the same two distinct selectors; **H/C labels:** 当当价 / 定价, previously missed |
| Promotions | Null. Static document has promotion templates, not actual promotion records; no active code/conditions verified in **D** | Same |
| Region / shipping / stock | Null. No verified region, warehouse response, stock, shipping fee or delivery time; no zero/free-shipping assumption | Same |
| Variants / other offers | Explicit title edition only; child products/variant price records unverified. `#sellers_list` empty, so other count/offers remain null, not zero/confirmed [] | Same |
| Description / official images | **S + H/C:** official cover + 8 gallery URLs; description/toc and description images remain unobserved | **S + H/C:** official cover + 2 gallery URLs; description/toc and description images remain unobserved |

The static prices are not verified dynamically rendered/current checkout prices.
The prior supplied 138/168 promotion inspection is not silently substituted for
these observations. The new report snapshots retain the original 05:10 source
prices and missing labels, rather than mixing fresh HTML values into old data.

Both pages expose the same observed ddShopId, so backend counts **one identified
shop in this batch**. It does not count shopId=0 as another seller, supId as a shop,
or infer total platform sellers. These are distinct ISBNs/editions; no comparable
same-edition price spread is calculated (`priceContexts=[]`).

The seven candidate callback routes (`product-info`, `transfer`, `score-service`,
`detail`, `get-bang-rank`, `get-promise`, `spu-prod`) still have **no verified response
body in this check**. No new extractor for those routes was invented. Chromium
attempted each page once; the ordinary document collector fetched each once.
Comment endpoints and comment images were blocked in Chromium; no explicit
comment request was made by the collector.

Sanitized observed HTML fragments are in
[the report fixtures](./tests/fixtures/enterprise-report/). They retain only
business DOM and a whitelisted JSON projection of product IDs; session data,
tracking attributes, original scripts and comments were removed.

## Changes in this follow-up

- [enterprise-context.mjs](./server/enterprise-context.mjs): report-only prompt and
  schema descriptions; anchored heading numbering normalization; exact observed
  product-title exemptions constrained by claim source IDs; numeric prices,
  ratios/counts and arbitrary names remain rejected; numeric field paths;
  missing limits distinguished from oversized input; new-snapshot saved-field
  projection. The DiDi prompt remains unchanged.
- [enterprise-product.mjs](./server/enterprise-product.mjs): verified static DOM
  byline/store/price-label selectors; normalized spec labels containing spaces;
  explicit title edition/self-operated provenance; pure saved-field projection.
- [enterprise-worker.mjs](./server/enterprise-worker.mjs): report validation usage
  and diagnostics, accurate failed provider-attempt status, obsolete pending
  report termination, optional report batch scope. No repair inference.
- [enterprise-api.mjs](./server/enterprise-api.mjs): separate missing-limit error,
  compatible read-only status for obsolete reports, retire obsolete pending
  reports before explicit new submission, runtime fingerprint, actual provider
  dispatch/retry state. Existing idempotency and daily cap retained.
- [ai-worker.mjs](./server/ai-worker.mjs): report runtime fingerprint logging;
  optional `ENTERPRISE_WORKER_BATCH_ID` scopes verification to Enterprise reports
  and skips ordinary Pro work. Without the flag, existing scheduling is retained.
- [Enterprise.tsx](./src/Enterprise.tsx), [styles.css](./src/styles.css): immediate
  submit/read state; backend queued/running/error/completed state; indeterminate
  model progress with reduced motion; separate collection/report completion;
  author/publication/spec fields and source paths in the viewer.
- [check-enterprise-report.mjs](./scripts/check-enterprise-report.mjs): numbers,
  exact source names, headings, scope/claim paths, wrong references, both rows,
  metadata, missing limits vs genuine oversize, obsolete tasks.
- [check-enterprise-db.mjs](./scripts/check-enterprise-db.mjs): preserved previous
  targeted integration checks, plus five-report cap/idempotency fixture.
- [check-enterprise-browser.mjs](./scripts/check-enterprise-browser.mjs): actual
  queued→model→completed UI fixture with no fake percentage.

Existing unrelated work was preserved. No auth, Free/Pro entitlement, DiDi prompt,
ordinary AI report prompt/pipeline, model allowlist, endpoint/key, SMTP, production
schema or historical snapshot was changed by this follow-up.

## Verification

Passed before paid requests: numeric/source/budget/metadata fixtures, Enterprise
pure fixtures and access fixtures; isolated Docker PostgreSQL integration checks;
Chromium UI queued/running/completed fixture, existing IME/chat/source checks;
typecheck and build. Five-report cap and idempotency were checked with mock
inference only in an isolated test DB.

Real check: both provider attempts and usage persisted; matching web/worker
fingerprints before each request; 2/2 old listing source coverage; failed report
state and title-derived edition source viewer verified on UI; refresh made zero
POSTs and no new provider request; no article or progress animation appeared for
the failed task; desktop/mobile had no horizontal overflow. Old snapshots and
history remained unchanged. Final real-model quality and a successful report are
**not verified**, because both real outputs failed validation.
