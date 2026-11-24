# Enterprise collector: VM release

Current deployment target is the existing Node/PostgreSQL VM, not the historical
Pages/Vercel instructions. No production operation is performed by these notes.
The report, chat and collection queues remain in their existing three services.

## Collector and acceptance

Normal Chromium navigation is observed passively. Page responses are not replaced,
replayed or deduplicated; ordinary assets and frames can load. Comment endpoints
and review images are excluded. Only the verified product callback routes with
matching product/shop identity become data. Scripts are not evaluated by the
parser. Website verification is never solved automatically.

Rendered DOM extractors preserve sale/list prices, promotion periods, selected
region, visible stock status, full shipping conditions, explicitly named delivery/
after-sales parties, order deadline and published arrival wording. Full product
sections are read from their inert expansion textareas when present. Unknown
values stay null. Observed DOM values remain visible if a callback fails; missing
sources and unfinished placeholders remain explicit. Differing source values are
retained with source IDs/paths. Color/size options remain DOM choice states, not
invented SKU mappings or inventory counts.

30114903 has a previously accepted real batch:
http://localhost:3001/enterprise?research=d044f5a1-7f55-4b5b-a170-b17b0db3c859
(78/90 CNY, promotion dates, region/stock, shipping6/free threshold49, named parties,
deadline/arrival, description/catalog and source viewers). It is not regenerated.
11972285896 has a previously accepted partial batch with price25.56/list315.92,
ISBN9787214009234 and the independently identified third-party shop:
http://localhost:3001/enterprise?research=a254ad28-93ef-4cf4-9c82-b27636a2a9c6
Missing description/variants in that batch were not filled from assumptions.

The later failed batch retained only HTTP/size/parser diagnostics, not its
110310-byte Document body; its exact original contents cannot be reconstructed.
A new ordinary Chrome inspection captured a separate HTTP405 Aliyun denial shell:
no product nodes, title405, hidden renderData and the specific denial wording in
an Aliyun script. This combination is now classified access_denied, not as a
product parser failure. The minimal fixture has no request/session identifiers.
A valid product mentioning such words is not rejected by this rule.

Final local UI batch (headless worker, same Docker DB/config fingerprint):
http://localhost:3001/enterprise?research=375e62b7-03cc-49cb-9640-978f011f97a7
Both requested books paused with challenge_detected, zero provider requests.
Fresh live book acceptance was therefore blocked; the earlier successful/partial
batches remain the verified real-data evidence. This release does not claim that
Dangdang access on the VM, or a new complete third-party book, was verified.

## VM requirements

- Node22+, PostgreSQL with the existing protected production environment.
- Playwright is a locked runtime dependency; `npm ci` installs it. It does not
  substitute for a browser executable.
- An executable Chromium/Chrome **on the report-worker host**. Auto-detection:
  /usr/bin/google-chrome, /usr/bin/chromium, /usr/bin/chromium-browser; override with
  ENTERPRISE_BROWSER_EXECUTABLE_PATH if the actual path differs.
- Default ENTERPRISE_BROWSER_HEADLESS=true: no display server/fourth service.
  ENTERPRISE_BROWSER_ENABLED must not be false for rendered collection.
- Keep browser sandbox enabled on a normal VM. Do not copy the local container's
  ENTERPRISE_BROWSER_NO_SANDBOX=true into the host service. A launch failure must
  be diagnosed against the service user/kernel policy; no unconditional bypass.
- ENTERPRISE_BROWSER_MANUAL_VERIFICATION_MS defaults0. Optional supervised headed
  use requires a real display; it is not an unattended server solution to WAF.
- Missing browser produces explicit HTTP-only/partial collection. Missing browser
  dependencies/permissions must be resolved before considering dynamic collection
  operational. Public source access can still be refused by Dangdang.
- Do not copy local AI_WORKER_INFERENCE_ENABLED=false, mock provider, batch/job
  scopes or credentials into production. Keep existing model/endpoint/key/limits.
  Web/worker must use the same database; retain the worker's existing direct
  WORKER_DATABASE_URL and all current service environment/configuration.

On Debian, if Chromium is not installed:

```bash
sudo apt-get update
sudo apt-get install -y chromium
```

On distributions where this package redirects to Snap, verify that the actual
service user can launch that browser; alternatively install supported Chrome and
set only the browser executable path in the existing report-worker configuration.
Do not assume a laptop Chrome path works on the VM. Check `--version` and launch a
headless `about:blank` page as the actual service user before enabling collection.
No model or remote product request is required for that smoke check.
For a non-root, named existing worker user, after installing dependencies:

```bash
WORKER_USER="$(systemctl show dangdangvoice-worker --property=User --value)"
BROWSER="$(command -v chromium || command -v chromium-browser || command -v google-chrome)"
test -n "$WORKER_USER" && test "$WORKER_USER" != root && test -x "$BROWSER"
sudo -H -u "$WORKER_USER" env ENTERPRISE_BROWSER_EXECUTABLE_PATH="$BROWSER" \
  "$(command -v node)" --input-type=module -e '
import {chromium} from "playwright";
const browser = await chromium.launch({executablePath:process.env.ENTERPRISE_BROWSER_EXECUTABLE_PATH,headless:true});
try { const page=await browser.newPage(); await page.goto("about:blank"); console.log("Chromium launch OK"); }
finally { await browser.close(); }
'
```

If this guard/smoke check fails, resolve the actual service user/browser/sandbox
requirements before activating rendered collection; do not disable sandbox to
make the command pass. When the executable is outside the auto-detected paths,
add only ENTERPRISE_BROWSER_EXECUTABLE_PATH to the existing worker environment or
a dedicated additive systemd drop-in, then daemon-reload. Preserve all other
production settings. No browser executable/configuration is required on a
separate chat-worker host.


## Pinned update (operator runs on VM)

Use the pushed SHA from the handoff for RELEASE. First confirm the checkout is
clean (ignored production environment files are retained). Fetch/fast-forward to
that exact commit, not an unbounded latest branch. Existing DB backup/release
procedures still apply.

```bash
cd ~/dangdangvoice/dangdangvoice-source
RELEASE=REPLACE_WITH_PUSHED_SHA
test -z "$(git status --porcelain)"
git fetch origin
git switch fix/ai-flow-node-pg
git merge --ff-only "$RELEASE"
test "$(git rev-parse HEAD)" = "$RELEASE"

# Preserve all service environment files/drop-ins; do not copy a local .env.
# Stop workers before replacing dependencies; keep Web running to reuse its env.
sudo systemctl stop dangdangvoice-worker dangdangvoice-chat-worker
npm ci --include=dev
npm run build

# Reads the running Web process environment privately, under its runtime identity.
# Does not print/write credentials, reset users or start any model worker.
sudo "$(command -v node)" scripts/migrate-vm-service.mjs --check
sudo "$(command -v node)" scripts/migrate-vm-service.mjs

sudo systemctl restart dangdangvoice-web dangdangvoice-worker dangdangvoice-chat-worker
sudo systemctl is-active dangdangvoice-web dangdangvoice-worker dangdangvoice-chat-worker
```

Migration012_enterprise.sql is the sole new migration in this release; the runner
applies only unapplied versions, preserving Free/Pro rows and existing history.
It must run before the new Web API is activated. If the existing Web service is
not running/does not expose NODE_ENV=production, the helper stops instead of using
a local .env. Correct the existing service environment, not its secrets in Git.
If any install/build/migration step fails, stop there and resolve it before
restarting workers. No update command invokes a model test, but restarted workers
resume normally authorized production queues under their preserved configuration.

Inspect service readiness locally for browserAvailable=true and matching Enterprise
fingerprints. Do not publish complete logs/configuration. Confirm owned history
loads without inference and collect one authorized book batch through the UI;
retain per-source failure/partial status if Dangdang refuses the VM egress.
