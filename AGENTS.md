> 最新入口/管理层：所有主应用入口先登录，独立 `/login`、`/register`、`/forgot-password`、`/reset-password`、`/verify-email`、`/app` 与 `/admin`；不再公开进入样例。003 迁移新增独立 role 与 Pro 到期、停用、升级申请、审计及唯一管理员约束。管理员通过受保护后台审核订阅；本地 bootstrap 只创建演示标识、不发送邮件、不重置已有密码。参见 [运维](./README-OPERATIONS.md)。本轮用户明确要求不运行测试或真实 AI 请求；SMTP 凭据缺失不得声称邮件可用。默认 qwen3.7-flash，worker 缺少密钥时空闲等待。

> Pro AI layer: migration 002 extends users.plan and adds durable AI jobs, immutable
> inputs, work units, attempts and private cache. All /api/ai endpoints reuse
> verified authentication and owner checks. HTTP processes never execute model
> work: run server/ai-worker.mjs on a separate persistent worker host. Never start
> a real provider worker or make paid requests without a spending allowance.
> Development mock reports must remain visibly labelled. See
> [Pro operations](./README-PRO.md); grant/revoke only through server/ai-admin.mjs.

> Current account/cloud-history implementation supersedes older “no database” and
> full-page gate notes below. Accounts and owned snapshots require external
> PostgreSQL via DATABASE_URL; missing configuration returns 503, never fake
> persistence. The landing, sample and local workflows are public. Relay and cloud
> history require a verified email account; optional DDV_ACCESS_PASSPHRASE adds
> a relay-only owner restriction in the same account area. See
> [account setup and release procedure](./README-ACCOUNTS.md). Run versioned
> migrations explicitly before a release, never in requests. Browser archives
> must only be copied to an account by an explicit user action. Do not grant
> anonymous database access as suggested by the historical V17 upgrade sketch.

# dangdangvoice — 当当之声 (QW Pages dynamic port)

## Project background

- **Problem:** Dangdang (当当) product pages show only a smoothed 好评率; buyers
  cannot see what real reviewers actually said (many "reviews" are system
  defaults), and sellers get no structured complaint breakdown. This is the
  published port of the desktop `dangdangvoice` tool built in this session.
- **Target users:** Chinese book/product buyers deciding before purchase, and
  Dangdang shop operators wanting review-driven action items.
- **Product goal:** paste any dangdang.com product URL → collect the public
  comment list pages and full-text comment details → analyze locally with a
  deterministic Chinese lexicon engine → present a "voiceprint" dashboard with
  concrete 买家情报 (buyer intel) and 卖家行动清单 (seller actions), exportable
  as CSV.

## Product shape

- **Page category:** dynamic (Node 22 `server.mjs` + React/Vite client under `src/`).
  Server endpoints today: `/healthz`, `/api/health`, `/api/session` (gate), `/api/status`
  (telemetry), `/api/relay`, `/api/analyze`, static SPA. Explorer filtering/paging, CSV/JSON
  export, browser archive restores are all client-side.
- **Live collection (V4: browser-orchestrated, stateless server):** the React client runs
  the workflow loop and calls pure step endpoints — `POST /api/relay {action: prime|list|detail}`
  (one Dangdang fetch per call, opaque egress cookie jar exchanged through each response,
  per-call rate limit, strict detail-URL allowlist) and `POST /api/analyze` (stateless
  classify+analyze+recommendations over posted comments). No server-side jobs/products/comment
  stores exist anymore, so instance cold starts, scaling and version roll-overs can never
  strand a run: progress lives in the browser, and partial results are still analysed with a
  visible warning. `prime` decodes the GB18030 product page for the title (meta names when the
  list/detail channel cannot answer); detail pages supply name/price/cover via .book_info.
  The old `POST /api/collect` job model is gone. Fetches still hit `https://product.dangdang.com/index.php?r=comment/list` (paged
  `pageIndex=1..pageCount≤37` via relay `list`, and, for truncated or sampled
  reviews plus meta fill-in, relay `detail` on
  `https://comment.dangdang.com/comment/detail/0/{pid}/{cid}` (allowlisted).
  Parsing is cheerio-based. The retry ladder (wait → wait → re-prime, per page)
  and the polite pacing now execute in the browser loop, so long runs never
  depend on any single server request outliving an FC deadline.
  When the site's own template caps a product's browsable comments (summary
  `pageCount` = 1 while total is large, e.g. 29871753), the job log states that
  explicitly so users see it as a site limit, not a failure.
- **App-owned access gate (optional):** when the owner sets Page env
  `DDV_ACCESS_PASSPHRASE`, every `/api/*` data route (except `/api/status` and
  `/api/session`) returns 401 until the visitor submits the passphrase;
  success mints a 7-day HttpOnly `ddv_s` cookie (HMAC of expiry keyed by the
  passphrase, constant-time compare, per-IP 20-fail/15-min throttle). Client
  renders a branded gate screen instead of any data. With the env var unset
  the page behaves publicly. Platform SSO was attempted and is unavailable on
  this account (enterprise-org requirement), so this is the gating mechanism.
- **Platform constraints (deliberate, disclosed in UI):**
  - No headless browser is available on QW Pages, so when Aliyun WAF serves the
    JS challenge to the cloud egress IP, live list-fetching fails. The server
    probes egress state (`GET /api/status`) and the UI degrades gracefully.
  - **No database:** the subscribing plan does not include the Pages database
    feature; provisioning/attach on the existing page was rejected
    (`quota-exceeded`), so all collected state is instance-memory only
    (ephemeral across cold starts/instances). There is intentionally NO
    local-file/SQLite durable store. Users must export CSV for persistence;
    the UI states this plainly. When the plan is upgraded: run
    `--provision-db --page-action update`, create idempotent
    `dv_products`/`dv_comments` DDL via the control API, add the dual-mode
    save/load paths, and republish with `--with-database`.
  - **Import mode & browser archive (the durability answer without a plan):**
  `POST /api/import` accepts the CSV (or JSON) produced by the desktop
  collector as well as a full snapshot payload `{product, comments}`. Beyond
  import, the client keeps a **localStorage browser archive** (≤5 products ×
  ≤440 comments + analysis snapshot, saved on every view) surfaced in the
  library drawer with one-click restore, plus a ⬇ full-archive JSON download.
  After an instance forgets (cold start), restoring from the browser archive
  round-trips through `/api/import` and re-renders the desk instantly.
- **Core flows:** intake (URL + pages/details sliders + engine probe) → live
  pipeline stage view with per-page meters, log tail, cancel → dashboard
  (product ribbon, buyer-pulse gauge, brief, 正面/中性/负面 split, signature
  voiceprint canvas, theme tiles, keyword chips, rating histogram, edition
  (类型) table, monthly trend, red-flag list) → buyer cards + seller checklist
  → comment explorer (filter/search/paging, links to original detail pages) →
  CSV export / text brief for clipboard.
- **Analysis engine (deterministic, in `server.mjs`):** blended sentiment =
  curated Dangdang-domain lexicon (incl. 盗版/影印/缺页 red flags and negation
  patterns) + star-score prior; 6 themes (内容质量/正版真伪/价格/物流/包装/服务);
  n-gram keyword extraction with stoplist; per-variant scores; monthly mood
  trend; default-review (系统默认/暂未填写) detection; rule-based buyer/seller
  recommendations and a text brief. Engine label surfaced in UI as
  `lexicon-blend (portable)`.
- **URL compatibility:** product id extracted from
  `product|www|item.dangdang.com/{id}.html`, `m.dangdang.com/product.php?product_id=`,
  `product.aspx?product_id=`, `/comment/detail/...`, or a bare id.
- **Visual identity:** Dangdang bell-red masthead with twin-bell mark, warm
  library paper, Noto Serif SC display / Noto Sans SC body / IBM Plex Mono
  data, card-catalog intake console, dark "voiceprint" strip as the signature
  element. Sentiment colors: green `#177B54`, amber `#D99B26`, rose `#B93A5B`.
- **Scope boundaries:** public comment pages only, jittered low-rate fetching,
  no login walls, no seller backend integrations, no durable analytics history,
  no platform SSO (public page).

## V6+ reliability layers (why any URL completes)

1. Cloud relay (`/api/relay`) when the FC egress window is clear — fast, no setup.
2. Blocked windows: tasks enter the persistent **retry queue** (localStorage,
   idempotent entries, exponential 20–120 s pacing, cap 40 tries, resumes across
   page visits; gentle mode = one probe list call per tick to protect egress
   reputation; Cancel removes the queue entry).
3. *(Browser-direct capture: REMOVED in V26 at owner request — was the bookmarklet+popup channel; resilience now = queue + built-in samples + import mode.)*

4. Built-in real sample datasets for the two flagship pids (clearly labelled,
   re-collectable) and desktop CSV/JSON import mode.

## Desk liveness contract (V16)

- The desk shows the CURRENTLY listened product, never a silent stale one:
  page-1 live commits swap header/analysis within seconds of the first list
  page; every 6 pages and every 10 detail reads refresh the analysis in place.
- While a new run is queued/waiting and its data has not arrived yet, a
  「正在聆听 #pid」 handoff note states exactly why the visible analysis is
  still the previous product — no hardcoded-looking behavior.
- Ownership token (genRef): submit/harvest/import/archive-click pre-empt
  running tasks; background queue probes and boot archive-restore can never
  overwrite the freshest user intent.
- Valid-but-empty products (endpoint answers `total_comment_num: 0`) complete
  immediately with an honest zero-note desk instead of queueing forever;
  soft-404 product titles are filtered out of meta.

## 评论库记录模块 + 数据库升级路径 (V17)

- src/Library.tsx — 评论记录库：跨所有已入库商品的记录表。每行 = 一条评论记录，
  列：product_id · product_name · 评论全文/列表文本 + score、date、sentiment、
  user/level、variant、has_image、is_default、source、detail_url。
  筛选：内容关键词、商品编号、商品名、情绪 chips、来源 chips、仅晒图、
  排除默认好评、仅当前商品；命中计数、20 行分页、行内点击回到该商品声纹台、
  展开全文、原评论链接。
- 当前持久层 = 浏览器档案库（localStorage，界面已注明）。relay/sample/import/
  browser-direct 四种完成路径都会自动入库，访客零操作。
- 真数据库暂未接入：实时尝试 --provision-db 返回
  "quota-exceeded: your plan does not include the database feature"，
  属于计划门槛，非代码问题。计划升级后的一次性激活步骤：
  1. publish.py --provision-db --page-action update --repo-root <repo>
  2. 走控制 API 迁移幂等 DDL 建表 dv_comments(id bigserial primary key,
     product_id text, product_name text, comment_id text, user_name text,
     level text, score integer, comment_date text, variant text,
     has_image boolean, is_default boolean, sentiment text,
     sentiment_conf real, text_list text, text_full text, detail_url text,
     source text, created_at timestamptz default now(),
     unique(product_id, comment_id))，并 GRANT anon/authenticated CRUD
  3. server.mjs 增加 /api/db/*（惰性双模 Broker/legacy 客户端、净化 503、
     筛选条件下推到查询），Library 数据源改为 库优先 + 档案回退，保存时双写
  4. 本地对真库跑写读验证，publish --with-database 上线

## V18 NLP upgrades (additive — nothing existing changed shape)

- classify(): lexicon scoring is now occurrence- and position-aware — negation
  flips ("不模糊"=positive, "一点也没…"), degree operators (很/非常/太/超 ×1.3,
  有点/稍微 ×0.6), tanh saturation calibrated to keep single-hit buckets
  identical to before. API, thresholds and label names unchanged.
- aspectEnrich() runs after analyze in /api/analyze and attaches optional
  fields (old browser archives without them degrade silently):
  aspects[] (10 book-commerce aspects, mentions, pos/neu/neg, satisfaction
  0–100, representative complaint quotes), aspect_rate, quality{avgLen,
  longRate, dupRate(水评检测), questionCount, exclRate, imgRate, recent30Rate,
  velocity, avgStar vs dictPos gap=水分指数}, faq[] (questions clustered by
  aspect — seller FAQ candidates), golden[] (best positive + most substantive
  negative quote), digest (templated analyst summary in Chinese).
- UI: two new guarded panels — ASPECT SATISFACTION + DATA QUALITY side by
  side, AUTO DIGEST (digest + golden quotes + FAQ) above red flags. Desk
  structure, voiceprint, library, queue, imports unchanged.

## V20 · PHOTO SCREEN WALL (买家秀晒图墙)

- Dangdang photo pattern: list fragment `li > a > img[src="*_p.jpg"][data-big-pic="*_e.jpg"]`
  on img*.ddimg.cn/Community*/…-reviewimg-…; the list envelope itself only
  carries a `pic_show_big` JS skeleton — URLs live beside thumbnails in
  `.pic_list` items. Server `collectPics($el)` (attribs-only, closure-free)
  extracts `{th,big}` per row in parseListFragment and parseDetailHtml;
  (the removed bookmarklet once mirrored this; live crawl is the sole producer now). All URLs normalized to https (CDN
  confirmed https + hotlink-friendly, so no proxying needed).
- Row contract: `pics?: {th,big}[] | null` added to CommentRow/CommentInput
  (CSV/DB columns untouched — desktop CSV import yields pics-less rows).
- Detail merge keeps the richer pics set; analyzeServer/archive preserve it
  via spread. New PhotoWall panel renders all shots of the current product
  as one wall + keyboard-navigable lightbox (Esc/←/→), sentiment-tinted
  borders linking each photo back to its comment's user/date/text.
  Absent pics → the panel hides itself (old archives safe).

## V21→V26 note

- The browser-direct (bookmarklet) channel was removed in V26 at the owner's request;
  harvest message contracts and bookmarklet code/guard no longer exist anywhere.


## V27 · unified live log (pattern restored)

- The flow/console surface was lost when the V26 harvest-modal cut over-swallowed
  the {job && <section id=flow>} block. V27 restores it as the 声纹日志: a single
  timestamped `HH:MM:SS …` log fed by every subsystem — runs (prime/pages/details/
  sample-fallback/completion/errors), queue ticks (auto-completion after windows,
  eviction, cap), submissions rejected by URL validation, imports, archive
  restores/failures, and the session seed line.
- Rendered whenever job OR log exists (always after first load), persisted per
  tab session (sessionStorage, cap 60, 清空日志 button); stages/meters still only
  during runs; nav 日志 → #flow resolves again.

## V30 · intent routing (why queued work now surfaces)

- Every background completion carries a rule: USER'S NEWEST submission
  (QueuedTask.intentAt === current intent seq) runs its retries as a full
  attempt — it may take over the desk, uses the sample fallback, and logs
  「正在为你最近提交的 #x 重试通道…」; older/foreign tasks remain silent
  (archive-only, 「未切换当前画面」) — the two requirements (never hijack a
  bystander desk / never strand the user's own request) now coexist.
- Defined terminal states for every submission: live success, sample
  completion, honest zero-comment product, foreign-domain rejection,
  capped-with-CTA queue. No silent no-ops.

## V31 · product identity rule (name/price/cover must equal the requested pid)

- Dangdang groups variant SKUs: a product's comment list contains detail URLs
  of OTHER ids (e.g. /0/30109627/) whose book_info would masquerade as the
  product itself.
- runTask treats identity strictly: title only from the prime fetch of the
  requested product page or from a detail page whose URL contains /0/{pid}/;
  cover and price only from exact-pid detail pages. Non-exact (variant) detail
  pages still contribute comment fields (text_full/score/date/user), never
  identity. If no exact-pid page yielded a cover, the desk shows an honest
  placeholder rather than a wrong book.

