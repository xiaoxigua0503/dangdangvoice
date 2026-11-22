# Dangdang JavaScript challenge classification

This change only touches the collection relay/parser, collection orchestration,
retry queue and related messages. No migration or new configuration is required.
AI/report/chat workers, models, account permissions and AI progress are unchanged.

## Confirmed code causes

- The old HTML guard only inspected the first 8192 characters, and only recognized
  an access-denied title or `aliyun_waf` / `_waf_` in scripts. Other verification
  shells could fall through to `invalid_json`, even with upstream HTTP 200.
- The frontend had no immediate pause outcome for a JavaScript challenge.
- Legacy archive-key scanning also consumed the collection queue key. Reading an
  archive could consequently remove persisted pause and cooldown state. The scan
  now explicitly skips that key; existing archive handling otherwise stays intact.

The VM response `/tmp/ddv-list-response.txt` was **not present locally**. No VM,
production endpoint or additional crawl was accessed. Exact identification of
that particular script has not been verified.

## Detection and contract

JSON parsing takes priority. Both an object and a JSON-encoded string in
`data.list` retain the existing comment parsing path. Comment selectors, rating
handling and empty/default-review classification are unchanged. Markers in valid
JSON/comment content do not trigger the top-level HTML classifier.

The inert HTML classifier distinguishes explicit access denial, a characteristic
JavaScript verification shell, ordinary HTML, and unknown non-HTML input.
Verification requires **all** of:

- no title, form, meta refresh, visible text or recognized comment nodes;
- inline script content greater than 80% of the response;
- an `aliyun_waf` / `_waf_` script marker; or a generic `captcha` / `challenge`
  marker accompanied by at least 1024 script characters and browser-runtime
  references (`document`, `window`, `location` access or `cookie`).

Length, a marker word, invalid JSON, or the presence of scripts alone is
insufficient. This deliberately conservative classifier is not a guarantee to
recognize all verification pages. Scripts are parsed as strings and never run.

Detected challenges return `ok:false`, `blocked:true` for caller compatibility,
`outcome:challenge_detected`, `code:challenge_detected`. Upstream HTTP status is
separate and can be 200. Ordinary HTML at the JSON list endpoint returns
`unsupported_response / unexpected_html`; malformed JSON retains a parser error.

Failure diagnostics record stage, outcome, code, upstream status, bounded MIME
type, response length/unit and boolean rule names. Text length is characters;
product-page buffers use bytes. Unread error bodies have unknown length (`null`).
No source body, scripts, challenge tokens, cookies or full comments are logged.

## Pause and preservation

A challenge at prime/list/detail exits crawling immediately, bypasses automatic
retry and built-in sample fallback, and persists the existing queue entry as
paused. Reload does not resume it. Manual retries retain server lease/rate
checks and respect both the existing backoff cooldown and `Retry-After`.
Previously stopped entries remain stopped even if a late response arrives.
The queue format/key remains compatible with old entries.

Actual metadata and comments are retained. Partial snapshots record the stage,
comment/page count and missing scope. Raw comments are archived before the
existing deterministic basic-analysis endpoint is attempted; its failure cannot
lose the retained inputs. Empty data does not invoke that endpoint or submit an
AI job. No report/chat inference is introduced.

## Offline verification

- `node scripts/check-collection-challenge.mjs`: JSON object/string, marker words
  in comments, ordinary/insufficient HTML, explicit denial, characteristic
  script shells including a marker past 8192 characters, parser errors,
  empty/default outcomes, persisted pause/reload, archive queue protection,
  cooldown and stopped/cancelled entries. Fetch is forbidden in this script.
- `node scripts/check-challenge-browser.mjs` with local Vite on port 4174:
  prime/list/detail challenge pause, retained partial data, sample-fallback
  prevention, manual cooldown, reload, automatic queue self-pause, cancel with a
  late response, desktop/mobile width. Every API is mocked and external requests
  are aborted. Only the local UI and Vite modules are loaded.
- `node scripts/check-collection-progress.mjs`: existing small offline compatibility
  fixtures (no network/provider).
- `npm run typecheck` and `npm run build`.

These checks do not establish live upstream availability or real AI quality.
No production migration, service restart, deployment, commit or push is part of
this change. A later authorized VM release can use the existing release/service
procedure; there are no worker/config/schema changes for this patch.
