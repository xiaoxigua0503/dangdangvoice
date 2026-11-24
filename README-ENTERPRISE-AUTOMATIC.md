> Historical acceptance notes. Current passive collector and VM update procedure: [VM release](./README-ENTERPRISE-RELEASE.md). The interception implementation described below has been replaced; do not use it as current deployment guidance.

# Automatic Enterprise collector — local verification 2026-11-24

## Acceptance is blocked, not complete

Created through the ordinary paste-links UI, processed by the ordinary report
worker entrypoint (not a DB seed/import or a private collector implementation):

- Three requested listings: http://localhost:3001/enterprise?research=c011d4ef-3442-44c6-9b27-1ad3bc9cc49a
- Additional non-book item: http://localhost:3001/enterprise?research=360ef02b-4af1-4c40-900e-1f6778d7b958

All four fresh worker Document reads returned HTTP200, text/html UTF-8,
16124-byte JavaScript challenge shells, before product scripts could execute.
Source diagnostics record `transport: normal_browser`, `stage: product_document`,
`code/outcome: challenge_detected`. Each listing is paused, not complete. The
three-listing batch is0/3; the clothing batch is0/1. No automatic replay, report,
chat or inference was created. No new snapshot exists for these empty batches.
This is **not** successful fresh-data acceptance or verification of AI input on a
new live report. Historical reports and synthetic fixtures are not substitutes.

## Direct page comparison

A bounded earlier Chrome inspection in this turn obtained valid product Documents
for all four items, but each observed `callback/product-info` response could not
be parsed as business JSON. Subsequent worker reads encountered the challenge
already at the Document. No challenge solution, stealth/fingerprint modification,
IP rotation, account login, cookie transfer or challenge-script execution was
used. Inspection and worker used clean anonymous contexts; no actual delivery
region was obtained in this turn. No same-region shipping/checkout comparison
can be asserted.

| Item | Verified public Document / rendered fallback | Still not accepted on fresh worker data |
|---|---|---|
|11972285896|洪业：清朝开国史, 江苏人民出版社,2010年07月, ISBN9787214009234;16开/胶版纸/平装-胶订; 概念图书专营店 at shop.dangdang.com/25316, shopId25316/ddShopId0. Initial price25.56/list315.92 are page quotes, not a confirmed dynamic sale price.|All fields in the new batch: Document challenge. Dynamic price/promotion/stock/shipping already unavailable during browser comparison.|
|24193243|洪业：清朝开国史（增订版）, ISBN9787513323802, 新星出版社,2017年03月;16开/精装/胶版纸. Shop 新星出版社当当自营店, shopId0/ddShopId258/supId19640. Initial price118/list118.|Same; no current promotion or delivery condition was verified.|
|30119333|洪业：清朝开国史（修订版）（当当专享特装版）, ISBN9787513364119, 新星出版社,2026年11月;16开/精装, blank paper row. Same independently identified self-operated shop. Initial price168/list168.|Same. The earlier-turn dynamic138 and promotion6575370 are **not** treated as this turn's current observation.|
|11902920274|361度 women's short-sleeve sports top, brand361度/model662524119V, shop361度旗舰店, shopId8064/ddShopId0, category运动户外>运动服装>T恤/背心. DOM product specifications include material/function/style. No ISBN/book fields invented. Price node not a verified scalar sale price.|Same. A subsequent structural inspection was also blocked; no new size/color selector was guessed.|

Only an empty paper row for30119333 and empty seller/variant containers were
observed. Neither establishes that paper details, variants or other shops are
never published. Fields unavailable behind failed dynamic sources are marked
`暂未读取`, not classified as definitively unpublished. No record in this run
supports an “all fields correctly collected” or “no other sellers” claim.

## Implementation

- [browser worker adapter](./server/enterprise-browser.mjs): normal Chromium page
  load within the existing durable report-worker process; inspect the Document
  before allowing its scripts to run; collect only the seven verified public
  business routes the actual page requests. No guessed/replayed endpoint calls.
  Intercept and reject challenge/non-JSON callback responses before delivering
  them to page JavaScript. Product ID and shop identity checked before parsing.
- Browser lifetime35s, document20s, callback10s;2MB per response,5MB aggregate
  callback bodies, bounded post-render wait. Anonymous ephemeral contexts are
  closed on success, failure, cancellation and timeout. No browser service or
  persistent cookie/profile is introduced. Images/media/fonts and review/comment
  requests are blocked; only official image URLs are retained. Navigation/remote
  hosts are restricted to the public Dangdang/CDN flow; frames are not followed.
- [product parser](./server/enterprise-product.mjs): third-party `shop.dangdang.com`
  anchors now handled; role separator in author/translator byline supported;
  dynamic sale/list values and conditional promotion prices remain distinct.
  Description/recommendation/catalog/official detail-image extraction uses the
  verified named sections, excluding the recommendation/ad rail. Grouped stock
  codes/member-price tiers are raw business metadata until meanings/conditions
  are verified; they are not inventory counts or confirmed retail member prices.
- `差价返还` belongs to shop.services, **not shop.afterSales**. The latter remains
  a seller/provider name only when directly identified. Gift wrap and optional
  card charges do not become shipping charges. Full delivery wording belongs to
  delivery.promiseText, not an invented structured shipping fee or arrival time.
- Expected source failures produce `collectionCoverage.partial`, per-source
  outcomes and per-field `temporarily_unread`. Dynamic sale price remains null
  when its source failed; the initial HTML quote is retained separately as an
  initial_document observation. Unknown fields do not become0/false/empty arrays.
- [UI](./src/Enterprise.tsx): partial and temporarily-unread labels, source buttons,
  generic product details, conditional-price/public-delivery wording and service
  declarations. Book-only main fields are hidden for non-book products.
- [snapshot context](./server/enterprise-context.mjs): new JSON metadata and field
  statuses flow through the existing immutable snapshot/AI-input path. Coverage
  wording reflects rendered/response data. Browser module included in the existing
  Enterprise fingerprint. Report schema, prompt, model, provider and fallback
  behavior are unchanged; no additional inference stage.

No migration or rewriting of old JSON is needed. Already saved incorrect service
mappings are not silently rewritten in historical snapshots.

## Runtime / packaging

Playwright moved from devDependencies into dependencies without changing its
locked version. [worker Dockerfile](./deployment/worker.Dockerfile) installs
Chromium in the existing worker image. No fourth service is required.

| Setting | Default / meaning |
|---|---|
|ENTERPRISE_BROWSER_EXECUTABLE_PATH|Auto-detect common Chrome/Chromium paths; Docker sets /usr/bin/chromium.|
|ENTERPRISE_BROWSER_ENABLED|Enabled when executable available; explicit false uses HTTP with partial/missing-render status.|
|ENTERPRISE_BROWSER_NO_SANDBOX|False by default on VM. The dedicated non-root Docker container sets true; local container verification explicitly used true.|
|AI_WORKER_INFERENCE_ENABLED|True by default preserves existing behavior. Local verification sets false so the normal worker collects Enterprise pages but cannot dispatch Enterprise/Pro inference. Does not modify the repository.env.|

For a later authorized release, install production dependencies/browser in the
existing report-worker runtime and update web/report/chat services from the same
checkout/fingerprint using the existing service/config procedure. The browser
runs as a child of the report worker. No production service was restarted here.

Verified locally: `npm ci --omit=dev --ignore-scripts` in an isolated runtime
package and Chrome launch/close from its production-only Playwright dependency,
with zero requests. Build packaging includes the browser module. This is not a
VM deployment or a complete Docker-image/systemd sandbox verification.

## Checks

Passed targeted product/access/report/metadata fixtures; automatic callback
schema/identity/conditions tests; fake-browser runtime for callback/document
challenge rejection, request bounds, review blocking, cleanup/cancellation;
metadata UI partial state/source viewer tests; existing Enterprise/report/DiDi UI
regressions; typecheck/build. Network is disabled in fixtures. These establish
code behavior, not successful fresh collection or real model quality.

Actual collection acceptance remains blocked by the Document challenge; new
report snapshot/AI-input acceptance consequently remains unverified. A working,
permitted public source path from the worker, or an appropriately licensed
product feed, is still missing. The application cannot legitimately obtain these
fields by solving/evading the access challenge, importing old values, or asking
users to copy DevTools data. The current UI requires none of those manual steps.

No Qwen request, production DB operation, migration, deployment, commit or push.
