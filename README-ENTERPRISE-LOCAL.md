# Enterprise local verification — 2026-11-24

> Follow-up: see [real-provider verification](./README-ENTERPRISE-REAL-VERIFICATION.md) for the newer Docker/port 3001 run. Its two real Qwen requests failed validation; the earlier mock results below remain historical.

## Result and limitation

The local app, report worker and chat worker run against the same PostgreSQL 17
`ddv_enterprise_local` database on loopback port 55439, with `AI_PROVIDER=mock`.
The configured development database on port 5432 refused connections
(`ECONNREFUSED`); this was not evidence of a missing migration. No listener was
present there. `WORKER_DATABASE_URL` was unset in the original local environment.
The local launcher explicitly sets both database variables to the same local DB.
All migrations 001–012 were applied only to this new local database. Existing
Free/Pro records, production configuration and the repository `.env` were not
modified.

Both requested pages returned HTTP 200 **access verification**, in initial HTML
and after Chromium rendering. Neither returned product DOM or any of the seven
candidate callback responses. The real collector batch therefore contains zero
successful listings and two paused links. No report, conversation or model task
was created for that empty batch. A manual retry of each link was tested after
the initial parser diagnosis; there is no automatic challenge retry. Reload keeps
both links paused.

No dynamic-response extractor was added: there was no actual business response
body to verify. Completing dynamic metadata remains blocked on obtaining an
accessible product page / sanitized response capture. This result does not claim
that a new extractor exists or that the access restriction has been bypassed.

## Actual collection matrix

Every unknown below means **not observed due to access verification**, not zero,
false, or a confirmed empty list. Only input product IDs/URLs and collection
source diagnostics were saved. No product snapshot was fabricated.

| Field group | 30119333 | 24193243 |
|---|---|---|
| Product / edition | Input ID and canonical URL retained; title, ISBN, edition unavailable | Input ID and canonical URL retained; title, ISBN, edition unavailable |
| Shop | shopId, ddShopId, supId, shop name unavailable | Same |
| Prices | Display/list prices and labels unavailable | Same |
| Promotions | Codes and conditions unavailable | Same |
| Stock / delivery | Region, stock, warehouse, fee and delivery time unavailable | Same |
| Variants | Not observed | Not observed |
| Other sellers | No records observed; not claimed to be zero or empty | Same |
| Description / official images | Not observed; no review content/images fetched | Same |

Source for both columns: the respective canonical product URL, initial HTTP
200 `text/html; charset=utf-8`, collector response 16124 bytes, collected at
2026-11-24 04:42:37 UTC; region unknown. Rendered DOM showed `Verification`,
`Please slide to verify` and Aliyun slider elements. DevTools-equivalent Chromium
response capture observed **no callback business responses**. There are no
DevTools-only product values to promote into the real snapshot.

The supplied earlier inspection of 30119333 (ISBN 9787513364119, special edition,
shopId 0, ddShopId 258, supId 19640, prices 138/168 and promotion 6575370/102)
remains a **synthetic offline fixture**, not a current price observation. Those
values appear only in the separately labelled fixture demo; they were not
inserted into the live two-link batch. 24193243 could not be identified, so the
app does not claim that these links are the same book, edition or SKU.

## Source verification matrix

| Source | Actual result for both links | Extractor status |
|---|---|---|
| Initial document | Access challenge; no product facts | Existing HTML/embedded parser retained; specific challenge recognized |
| Rendered product DOM | Verification UI only | No product selector guessed |
| callback/product-info | No response observed | Disabled / unverified |
| callback/transfer | No response observed | Disabled / unverified |
| callback/score-service | No response observed | Disabled / unverified |
| callback/detail | No response observed | Disabled / unverified |
| callback/get-bang-rank | No response observed | Disabled / unverified |
| callback/get-promise | No response observed | Disabled / unverified; prior warehouse request context does not prove stock |
| callback/spu-prod | No response observed | Disabled / unverified |

Chromium interception blocked comment endpoints/review images. No guessed callback
URLs, alternate IPs, CAPTCHA solving, fingerprints or Open API credentials were
used. Only a small number of explicitly requested product page reads occurred.

## Changes in this follow-up

- [enterprise-product](./server/enterprise-product.mjs): recognize the observed
  hidden `textarea#renderData` shell together with dominant substantial Aliyun
  script/runtime markers, no visible product text and no product/comment nodes.
  Hidden textareas are ignored only for this conjunctive Enterprise rule. Neither
  their contents nor source scripts are executed or saved in fixtures.
- [enterprise-worker](./server/enterprise-worker.mjs): bounded collection
  diagnostics (stage, outcome/code/rule, HTTP status, content type, byte length,
  source URL, timestamp and dynamic-source availability). Failed reads save these
  in the existing task result JSON. No schema change.
- [enterprise-api](./server/enterprise-api.mjs): expose the latest owned collection
  diagnostics in the existing batch GET, with owner + batch + listing matching.
- [Enterprise UI](./src/Enterprise.tsx): distinguish a finished empty batch from
  usable collected data; show source status in existing details.
- [report worker](./server/ai-worker.mjs): readiness reports sanitized error code
  and reason for refused connections, auth failure, missing DB/schema/migration
  or network failure; no connection strings or credentials.
- [access checks](./scripts/check-enterprise-access.mjs),
  [DB checks](./scripts/check-enterprise-db.mjs), and
  [sanitized structural captures](./tests/fixtures/enterprise-live/).

Existing uncommitted Enterprise work was preserved. No new migration beyond
already-pending [012](./migrations/012_enterprise.sql) was needed. No production
migration, deployment, service restart, email or paid model call occurred.

## Local application and separate mock demo

Open http://localhost:3000/enterprise . The local Enterprise account's credentials
are in the ignored private file `.private/enterprise-local-credentials.json`.
They are not printed here. The actual batch URL is in
`.private/enterprise-live-batch.json` and its screenshot in
`.private/enterprise-inspect/local-real-batch.png`.

A separate batch titled `离线 fixture 演示（非本次实时采集）` exercises the running
web app and both persistent workers with the synthetic fixture. Report and DiDi
both completed with mock usage, survived refresh and were checked in PostgreSQL
to reference the same report, immutable snapshot and input document. The price /
shop question returns the explicitly labelled generic mock answer; this is no
proof of real model answer quality. The fixture batch URL is in
`.private/enterprise-demo-batch.json` and screenshot in
`.private/enterprise-inspect/local-mock-report.png`.

The three processes were left running. To restart **local only**, use the ignored
launcher from repository root (one terminal per process):

```sh
bash .private/run-enterprise-local.sh server/start.mjs
bash .private/run-enterprise-local.sh server/worker-start.mjs
bash .private/run-enterprise-local.sh server/chat-worker-start.mjs
```

Stop the existing local processes first to avoid duplicate workers/port conflicts.
The launcher pins both DB variables, mock provider, capture mail mode and local
origin. It does not change `.env`. Native temporary PostgreSQL tooling is outside
the repo under `/tmp/ddv-enterprise-test`; data is under
`/tmp/ddv-enterprise-pgdata`. This is a local development setup, not a VM release.

## Checks

Passed: typecheck/build; Enterprise pure fixture checks; new access fixtures;
PostgreSQL 17 Enterprise integration checks in a new disposable DB (no network);
existing challenge parser/queue fixtures; Chromium mocked Enterprise UI checks;
actual local UI two-link collection/manual retry/paused refresh; separate actual
local mock report/DiDi/snapshot persistence; mobile report width 390px without
horizontal overflow. Access captures contain booleans/structure only: challenge
scripts, tokens, trace IDs, renderData and personal data were omitted.

Not verified: current product prices/metadata, callback bodies/schema, stock or
shipping by region, real model quality, or successful retrieval of either page.
