# 当当之声：邮箱账户与云端历史

这是现有 React 18 / TypeScript / Vite + Node 22+ `server.mjs` 应用上的增量实现，没有更换框架。没有外部部署，也没有访问生产数据。QQ Mail、163 Mail 与其他普通邮箱使用相同的邮箱/密码流程，不依赖 Google、Firebase 或第三方身份服务。

## 本地启动

需要 Node 22+、npm、Docker Compose（或可连接的 PostgreSQL 17+）。示例凭据只用于本地开发，不要用于公网数据库。

```bash
npm ci
cp .env.example .env
docker compose up -d --wait
node --env-file=.env server/migrate.mjs
npm run build
node --env-file=.env server.mjs
```

打开 `http://localhost:3000`，**使用与 APP_BASE_URL 完全相同的域名和端口**。默认选择 SMTP；需配置真实发送主机、发件人与认证凭据，否则邮件操作诚实返回配置错误。只有显式改为 `MAIL_TRANSPORT=capture` 才进入开发捕获，不会真正发送：查看 `.dev-mail/` 下生成的 JSON 邮件文件，在浏览器打开邮件正文中的链接。该目录含私密、可用的邮件链接，已加入忽略规则；只限本地开发，完成后删除。验证码链接放在 URL fragment 中，页面读取后立即移除，不进入 HTTP 访问日志或 Referer。邮件发送和链接消费都由 POST 完成，不会被邮件扫描器的 GET 请求消耗。

开发热更新（另一个终端先以相同配置启动后端）：将 `.env` 的 `APP_BASE_URL` 改为 `http://localhost:5173` 并重启后端，再运行 `npm run dev`。Vite 将 `/api` 代理至 `127.0.0.1:3000`。

`npm start`、`npm run migrate`、`npm run ai:worker`、`npm run ai:admin` 和 `npm run bootstrap:local` 会读取存在的 `.env`；部署环境变量优先。新版入口与管理员操作见 [本地与发布运维](./README-OPERATIONS.md)。

## 配置

| 变量 | 用途 |
|---|---|
| `DATABASE_URL` | PostgreSQL 连接字符串；账户与云历史唯一权威存储。缺失返回 503，不退回内存或本地文件 |
| `APP_BASE_URL` | 唯一站点完整来源，如 `https://voice.example.cn`；邮件链接与 CSRF Origin 校验使用它；生产必须 HTTPS |
| `HOST` / `PORT` | 原有 Node 监听配置；本地为 `127.0.0.1` / `3000`，容器按平台要求通常为 `0.0.0.0` 和平台端口 |
| `NODE_ENV` | 生产必须设为 `production`，启用 Secure 会话/站点口令 cookie、SMTP TLS 和配置校验 |
| `MAIL_TRANSPORT` | 本地显式设 `capture`；生产设 `smtp`，生产启用 capture 会拒绝启动 |
| `MAIL_CAPTURE_DIR` | 可选，仅开发 capture 模式写入权限 0600 的邮件 JSON；不设置则仅进程内捕获供集成测试读取，没有公开邮件 HTTP 接口 |
| `SMTP_HOST` / `SMTP_PORT` | 真实事务邮件服务器；常见为 587 STARTTLS 或 465 TLS |
| `SMTP_SECURE` | 465 通常设 `true`；587 设 `false`，生产会强制要求 STARTTLS |
| `SMTP_USER` / `SMTP_PASS` | SMTP 发信凭据；仅后端使用，不设 `VITE_` 前缀 |
| `MAIL_FROM` | 通过发信服务验证的发件地址，例如 `当当之声 <noreply@example.cn>` |
| `TRUST_PROXY` | 仅当反向代理可信、并覆盖客户端 X-Forwarded-For 时设 `true`；否则默认使用 socket IP |
| `DDV_ACCESS_PASSPHRASE` | 可选的站点管理员采集口令；不是用户密码，默认留空 |

不需要 `SESSION_SECRET`：账户 cookie 是 256 位随机不透明令牌，数据库只保存 SHA-256 哈希。密码使用 Node 原生 scrypt（N=32768、r=8、p=3，随机 128 位盐，64 字节派生值），使用异步运算和常量时间比对。会话固定 7 天；退出登录删除服务端会话，密码重置撤销该账户全部会话；没有“记住密码”本地存储。仅浏览器内存保存邮箱与用户 ID。

## 访问与旧口令的关系

首页、内置样例、分析接口、导入、导出和浏览器档案保持公开。每个 `/api/relay` 请求与云端读写均在服务端要求已登录且邮箱已验证。注册后可以登录查看“待验证”状态，并重发邮件；验证后刷新状态即可继续原先投递的采集任务。

旧的全页口令屏已移除。显式配置 `DDV_ACCESS_PASSPHRASE` 时，**只对实时采集增加管理员限制**；在同一个账户区输入站点口令，不会替代个人账户。`/api/session` 保留为旧站点口令协议，`/api/auth/me` 才是个人会话接口。此设置不再把整个首页、分析或个人云历史设为私有；如果需要全站私有部署，应在受控网络/反向代理层限制访问。

跨站 cookie 变更通过精确 Origin + JSON Content-Type 校验拦截，包含登录/注册、重发邮件、退出、站点口令、采集和删除。客户端与 API 应通过同一来源服务，不启用跨站 CORS。cookie 均 HttpOnly、SameSite=Lax，生产 Secure。API 账户和云历史响应为 `Cache-Control: no-store`，反向代理不得缓存带账户 cookie 的 API。

认证限流写入 PostgreSQL，**不是实例内 Map**：各动作每 IP 30 次/15 分钟，每邮箱 8 次/15 分钟（消耗链接按 IP 限制）。生产多个 Node 实例共享同一数据库即可共享限流；边缘网关仍应设置全局连接、请求体与并发预算。旧的站点口令失败限流和 relay 礼貌限流仍为实例内机制，多个实例时应在网关额外限流；可信代理配置错误会影响按 IP 限流。

验证令牌 24 小时、重置令牌 30 分钟，256 位随机且仅存哈希，成功消费时原子删除同类令牌。重复、过期和已消费链接统一提示重新申请；邮箱注册、重发和找回邮件成功文案不透露账户是否存在。SMTP 失败会明确返回 503、不声称已送达，并删除本次未发送的令牌；重试注册/重发即可恢复。密码错误与不存在邮箱统一提示邮箱或密码错误。

## 持久化和数据隔离

迁移位于 [`migrations/001_accounts.sql`](./migrations/001_accounts.sql)，由 [`server/migrate.mjs`](./server/migrate.mjs) 按版本记录执行，使用事务和 advisory lock，并发发布不会重复应用。不在请求中迁移。

- `users`：规范化小写邮箱唯一、密码哈希、验证时间。
- `sessions`：令牌哈希、用户外键、失效时间与索引。
- `email_tokens`：验证/重置用途、令牌哈希、用户、过期时间；单次消费。
- `auth_limits`：共享限流窗口与次数。
- `saved_runs`：用户所有权、UUID 幂等键、完整 product JSONB（含分析快照、来源、时间、站点汇总、partial/sample 提示）、引擎（lexicon-blend/18）与 schema 版本。
- `saved_comments`：按 run ID + ordinal 保存每条评论完整 JSONB；保留列表/全文、星级、日期、版本、用户、等级、默认评价、图片缩略/大图和详情 URL。
- `schema_migrations`：已应用版本。

每份采集/导入生成独立快照；同商品不同运行不会覆盖。保存重试、当前结果重复保存复用同一幂等键；本地复制使用账户 + 商品 + 本地保存时间产生稳定键。服务端还检查提交的 ownerId，账户 A 启动的保存即使携带账户 B 的新 cookie 也会拒绝。所有云端详情、列表、导出所需的下载及删除都按当前会话所有者查询，别人 ID 返回 404，没有公开或管理员读取接口。数据库应使用只供应用后端访问的专用角色，不要向匿名客户端开放这些表。

云记录通过数据库进行商品/评论内容搜索、来源筛选和每页 20 份快照分页。云端完整 JSON 与 CSV 均先经所有权校验获取。恢复后原有声纹台、评论筛选、晒图墙和导出继续工作。

浏览器档案继续保留原有 5 个商品 × 440 条限制，UI 明确标为本设备数据。不会在登录后自动上传旧档案，必须点击“将本浏览器档案复制到此账户”并确认。**云历史不使用 440 条限制**；API 明确支持单份最多 20,000 条，保存请求最多 20MB，分析请求最多 12MB；超限拒绝而不截断。完整 JSON 导出也已移除旧的 440 条切片并保留晒图与分析快照。CSV 保持原有字段兼容性，图片与分析快照请用 JSON。

采集/导入完成后，若启动时已验证登录，会自动尝试云保存；失败仍保留声纹台、本地档案与导出，可重试。任务捕获账户身份及切换世代，切换后不会把旧任务自动上传给新账户。账户变化通过不含凭据的 BroadcastChannel 通知同源标签页，回到标签页时也会刷新会话。云历史组件按用户重建，取消旧列表请求并忽略迟到的恢复响应；退出时清空已恢复的云端声纹台。浏览器重试队列记录启动账户 ID，只自动运行当前账户的任务；旧版无 ownerId 的任务须明确点击重试。会话过期后已收集的公开评论仍可分析和导出，重新登录后可手动保存。输入 URL 的待办只在当前页面内存中保留，邮件链接在新标签页打开时请回到原标签刷新验证状态；不会把认证凭据写入 localStorage。

## 发布到 QW Pages / 外部 PostgreSQL

当前计划**不包含 Pages 数据库**，本实现不尝试申请或假定该能力。使用可由 Node 服务访问的外部 PostgreSQL；连接池默认每实例 10 个连接。按实例数量配置数据库连接预算，必要时使用受支持的连接池代理。生产使用证书可验证的 TLS（如服务商要求的 `sslmode=verify-full`），不要关闭证书校验。私有 CA 通过受控运行环境提供。

发布顺序：

1. 备份现有数据库（如有），在测试库验证迁移；为应用创建专用数据库和权限最小的后端角色。首次迁移需要建表权限。
2. 在一次性 release job 或可信运维终端设置真实 `DATABASE_URL`，执行 `npm ci`、`npm run migrate`。不会在 HTTP 请求或每次进程启动时迁移；后续迁移增加新编号，不修改已部署版本。
3. 配置生产环境变量、HTTPS 自定义域名、SMTP 凭据。确认实例可出站连接 PostgreSQL 和 SMTP 465/587，安全组/白名单、TLS 证书和 DNS 均允许。`APP_BASE_URL` 必须是用户真实访问的来源，不能随请求 Host 拼接邮件链接。
4. 执行 `npm run typecheck`、`npm test`、真实隔离库测试。构建后的 `.qw-pages/publish/` 包含 `dist/`、`server.mjs`、`server/`、`migrations/`、package 与 lock 文件。安装运行依赖用 `npm ci --omit=dev`，以原来的 Node 入口启动，不需要 SQLite、可写应用目录或原生密码扩展。
5. 上传原有发布产物，遵循平台原有发布流程。**本次没有对外发布。** 计划是否允许环境密钥、外部数据库网络、SMTP 出站、Node 22 及依赖安装，必须由实际部署环境确认。不可把数据库/SMTP 凭据硬编码在发布产物、前端变量或日志中。
6. 用受控邮箱实际完成注册、验证、重置、退出、跨设备云历史与删除验收，再开放用户注册。给发信域名配置 SPF、DKIM、DMARC，监控退信及投诉。QQ/163 是收件服务商，并不要求使用 QQ/163 发信服务器；两家的实际收件率、延迟、垃圾箱分类均尚未验证。

定期在外部调度器执行 `npm run db:maintenance` 清理过期会话、邮件令牌和限流窗口（需要同样的 DATABASE_URL）。数据库备份、恢复演练、监控和存储配额由部署方负责；本功能没有订阅、支付或自动删历史机制。

## 验证命令与结果

```bash
npm run typecheck
npm test
# 独立测试数据库示例；集成测试只在随机 schema 内建表并在结束时删除。
docker compose exec db createdb -U dangdangvoice dangdangvoice_test
TEST_DATABASE_URL=postgresql://dangdangvoice:local-development-only@127.0.0.1:5432/dangdangvoice_test npm run test:accounts
# 安装浏览器一次，然后包含浏览器测试；使用本机 Chrome 时可指定 BROWSER_EXECUTABLE。
npx playwright install chromium
RUN_BROWSER_TESTS=1 TEST_DATABASE_URL=postgresql://dangdangvoice:local-development-only@127.0.0.1:5432/dangdangvoice_test npm run test:accounts
```

集成测试不允许缺省 TEST_DATABASE_URL，不会以假内存数据库通过测试。数据库生命周期测试覆盖注册、重发、邮箱验证、登录/退出/过期、找回、重置及令牌过期/复用、两用户所有权、ownerId 账户切换拦截、CSRF、限流、幂等、相同商品不同运行、恢复/删除、完整 601 条评论与图片字段。邮件只使用本地 capture，并另外模拟未配置 SMTP 的 503/令牌清理。可选真实浏览器测试检查桌面/手机、登录、样例、云保存幂等、恢复、退出清屏、迟到响应隔离，以及会话过期保留可导出的结果。

初次验证在 Docker daemon 尚未启动时，使用 `/tmp` 内临时下载的真实 PostgreSQL 18 二进制启动独立测试库（没有作为应用依赖或生产存储引入）。Docker Desktop 启动后，已通过项目 Compose 配置拉起 PostgreSQL 17.12，在独立的 `dangdangvoice_test` 数据库重跑全部账户与浏览器测试，并成功迁移本地开发库。浏览器验证使用本机 headless Chrome，桌面 1440px 与手机 390px。独立发布包测试复制到临时目录、只安装 production dependencies 并以不可写应用目录启动，验证根页面与健康接口。现有依赖审计显示运行依赖无已知漏洞；Vite 的开发工具链仍有 picomatch 相关 advisory，需要持续跟进上游修复。

**尚未验证：真实 SMTP 发信、QQ/163 收件、现有 QW Pages 的外部数据库/SMTP 连通性、密钥注入以及生产部署。成功的本地 capture、数据库测试或构建不代表以上能力已经成立。**

本次最终执行结果：`npm run typecheck` 通过；`npm test` 的 10 项 URL/照片/本地存储回归与 1 项独立发布包运行测试全部通过；开启 `RUN_BROWSER_TESTS=1` 后，4 项真实 PostgreSQL/SMTP 失败/生产 cookie/Chrome 集成测试全部通过。数据库测试还覆盖并发幂等保存、跨页查询、可选站点口令与会话过期后的前端导出保留。`npm audit --omit=dev` 为 0 个已知漏洞。首轮常规本地测试使用 Node 24.22.1；随后使用 Node 22.23.5 重跑全部 11 项回归/独立发布包测试，以及 Docker PostgreSQL 17.12 上的全部 4 项集成测试，均通过。浏览器测试还实际打开捕获邮件中的验证和重置链接，验证链接消费、URL 令牌清除和新密码登录。

Free/Pro 和独立多模态报告已在现有账户上扩展，迁移与独立 worker 的操作见 [Pro 部署说明](./README-PRO.md)。基础分析的访问规则不变。
