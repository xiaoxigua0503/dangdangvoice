# 当前源码的生产部署（2026-11-18）

当前生产入口：**https://dangdangvoice.vercel.app/login**。托管项目 `xiaoxigua/dangdangvoice`，区域 `sin1`，Web 为 Vercel Node 22 Functions + 当前 Vite 静态资源，AI 为独立 Vercel Daemon `ai-worker`。没有以旧 ZIP 发布，也没有把缺失后端的静态页面称为完成。

## 已完成与尚未完成

- 已创建 Vercel Hobby 项目，明确选择 Neon `free_v3` 免费方案创建独立 `dangdangvoice-prod` PostgreSQL（Singapore），关闭 Neon 自带认证，复用本项目现有账户实现。通过 Vercel Marketplace 完成了 Neon 集成安装；没有升级套餐、购买服务或开启付费方案。
- 新生产库已显式应用 001、002、003 迁移；没有复制本机用户、密码、评论、AI 报告或 Docker 卷。笔记本数据库仍保持原样，不暴露公网。
- `DATABASE_URL` 由集成提供，HTTP 使用其连接；`WORKER_DATABASE_URL` 使用同库的 **unpooled 直连**，避免事务池化破坏 worker 的会话级 advisory locks。HTTP `/readyz` 查询数据库迁移版本，worker 启动也检查直连与迁移。生产连接显式使用 verify-full，worker 镜像包含系统 CA 文件，不关闭证书校验。
- 环境配置使用 Vercel production secrets，实际固定 `APP_BASE_URL=https://dangdangvoice.vercel.app`、`NODE_ENV=production`、`TRUST_PROXY=false`。保持正式 Host + Origin/Referer、JSON、CSRF cookie/header 校验。HTTPS cookie 使用 Secure，CSRF cookie 使用 `__Host-`。`NODEJS_HELPERS=0` 保留原始 HTTP body stream。
- Qwen 北京 endpoint、`qwen3.7-flash`、120 秒超时、并发 2 和现有本地 AI key 已配置到服务端生产 secrets。**未发送自动模型测试请求**。按 owner 最新指令已设置 `AI_WORKER_ENABLED=true` 并重新部署，等待 owner 在 UI 手动提交分析。空闲时两个并发循环各每 1.5 秒轮询 PostgreSQL；没有工作单元时不调用模型，但会保持数据库活跃并消耗 Daemon 内存额度。
- **SMTP 已补齐生产配置，未验证真实投递**：Gmail 主机、465/TLS、SMTP 用户名/密码及 MAIL_FROM 已配置。MAIL_FROM 使用同一认证地址。用户本轮提供的凭据实际位于本地私有 `.env`，此前生产项目环境列表没有 SMTP 变量；已安全补入该项目 Production secrets，未输出地址或密码。没有发送邮件或验证 SMTP 登录/实际投递。
- **生产 owner 使用受控 CLI 提升**：没有默认管理员、没有导入演示账户。本轮没有擅自指定或提升邮箱；真实 owner 需正常注册和完成验证，再运行下面的命令。未验证账户不能被此命令提升，既存其他管理员会阻止替换。

这是已部署并启用 worker 的完整技术栈；SMTP 真实投递、模型推理仍由 owner 手动验证，生产 owner 需通过下方受控命令初始化。

## Qwen 优先检查结果

从仓库原打包说明找到既有页面 `app-8f4234b7-4ed153f9` / https://waf8xws9.qwenwork.page/，对其 `/healthz` 的最小 HTTP 请求返回 200。没有删除、重新创建、改环境变量、迁移或覆盖这个页面。

[QwenWork 官方文档](https://docs.qwenwork.ai/web/platform) 确认动态页面支持 Node.js 与可选托管数据库；但本会话没有 Qwen 发布工具/控制面凭据，浏览器 QwenWork 为 Guest，无法核实当前账户的秘密配置、原始 PostgreSQL 直连权限、常驻 worker、SMTP 与 Qwen API 出站权限。历史源码中的数据库额度拒绝记录不能证明当前账号仍相同，也不能证明托管数据库能供外部 worker 直连。没有把 HTTP 实例内 promise 当作常驻 worker。因这些条件无法验证，使用已登录、能够实际部署 Daemon 的 Vercel 备选。

## 免费资源限制与出站能力

已核对 [Vercel Daemons](https://vercel.com/docs/daemons)、[Daemon 配置](https://vercel.com/docs/daemons/config-reference) 与 [额度](https://vercel.com/docs/daemons/limits)：当前 Public Beta 包含 Hobby。这里显式使用一个 1 GiB 实例，而非默认 2 GiB；独立容器运行 `node server/worker-start.mjs`，由平台监督和重启，SIGTERM 有 30 秒清理时间，任务与恢复状态仍在 PostgreSQL。

Hobby 每月 420 GB-hours 内存、5 Active CPU-hours；即使等任务，常驻内存也计入额度。1 GiB 连续运行约 420 小时（17.5 天）即达到内存额度，不能承诺免费整月 24/7。到额度会停止到下月；未自动升级。需要整月可靠运行时必须另行确认容量/费用方案。Neon 免费计算/存储也有额度，持续数据库轮询会消耗它；在供应商面板监测，不能声称无限免费。Hobby 限个人非商业用途，正式商业运营另需确认计划许可，见 [Hobby 说明](https://vercel.com/docs/plans/hobby)。

[Vercel 官方 SMTP 说明](https://vercel.com/kb/guide/serverless-functions-and-smtp) 允许出站 SMTP（25 端口除外），本项目使用 587 或 465。生产 Web 到 PostgreSQL 已通过就绪请求确认；worker 的直连由启动日志确认。真实 SMTP 没有凭据无法验证，Qwen 实际推理按要求未验证。Function 请求体仍受平台约 4.5 MB 上限影响，不能接受本地服务器支持的全部 20 MB 单次云保存；这不会把数据静默截到 440 条，但大快照需要后续分块上传适配或采用请求体限制更宽松的 HTTP 托管。应用基础分析和本地完整导出保留。Function 设置 60 秒，只处理有限 relay/API 请求，AI 不在其中运行。

## 从当前源码再次发布

发布准备使用严格文件允许列表，只拷贝当前构建、后端、迁移、Node adapter 和 worker 依赖。`.env*`、`.private/`、演示密码、Docker 卷与历史 ZIP 均不在发布包中。worker Dockerfile 也只 COPY package 文件、server 和 migrations，不使用 `COPY . .`。

```bash
npm run release:prepare
# 第一次链接；再次 prepare 会保留既有 project.json 关联
vercel link --yes --project dangdangvoice --scope xiaoxigua --cwd .release/vercel
# 所有凭据在平台 production environment 设置，不要用 --env KEY=secret 暴露在命令行
vercel deploy --prod --yes --scope xiaoxigua --cwd .release/vercel --logs
vercel daemons inspect ai-worker --scope xiaoxigua --cwd .release/vercel
vercel logs --query 'source:daemon' --since 10m --scope xiaoxigua --cwd .release/vercel
```

首次 `vercel link` 可能生成 `.env.local`；发布忽略规则排除它。生产 Web/worker 不读取随代码附带的开发 `.env`。所有 provider 更新都要保留账户与历史库，运行迁移只用一次性 release 命令，不在 HTTP 请求内执行。

## 生产环境变量与 owner

平台配置入口： https://vercel.com/xiaoxigua/dangdangvoice/settings/environment-variables 。环境为 Production。

| 配置 | 当前状态 |
| --- | --- |
| DATABASE_URL | Neon 集成提供，生产 PostgreSQL |
| WORKER_DATABASE_URL | 同库直连，Secret |
| APP_BASE_URL | https://dangdangvoice.vercel.app |
| NODE_ENV / NODEJS_HELPERS / TRUST_PROXY | production / 0 / false |
| MAIL_TRANSPORT | smtp |
| SMTP_HOST / SMTP_USER / SMTP_PASS / MAIL_FROM | 已补齐，不在文档中记录值 |
| SMTP_PORT / SMTP_SECURE | 465 / true（Gmail） |
| AI_PROVIDER / AI_MODEL | qwen / qwen3.7-flash |
| AI_BASE_URL | https://dashscope.aliyuncs.com/compatible-mode/v1 |
| AI_API_KEY | Secret 已设置；权限与推理未验证 |
| AI_REQUEST_TIMEOUT_MS / AI_MAX_CONCURRENCY | 120000 / 2 |
| AI_WORKER_ENABLED | true；owner 通过 UI 手动提交任务 |

真实发信服务需要已验证发件域/地址、SMTP 认证及必要 SPF/DKIM/DMARC；APP_BASE_URL 已用于验证/重置链接。不要使用本地捕获模式或演示标识替代真实邮箱。

本机的 `.private/production.env` 是通过 CLI 下载的生产数据库凭据，目录 0700、文件 0600，已 gitignore，绝不作为网站资产。它没有本地演示密码。不要公开内容，也不要用它覆盖本地 `.env`。以下命令明确使用生产配置，不会误运行本地 bootstrap：

```bash
# 确认 SMTP 配置并重新部署后，owner 在生产站点正常注册并验证。
# 替换 OWNER_EMAIL，命令拒绝保留演示邮箱、未验证账户及其他既存管理员。
NODE_ENV=production APP_BASE_URL=https://dangdangvoice.vercel.app \
 node --env-file=.private/production.env server/owner-admin.mjs OWNER_EMAIL https://dangdangvoice.vercel.app
# 单独、明确地授予或撤销用户 Pro（也可由生产管理员后台操作）
NODE_ENV=production APP_BASE_URL=https://dangdangvoice.vercel.app \
 node --env-file=.private/production.env server/ai-admin.mjs grant-pro USER_EMAIL
NODE_ENV=production APP_BASE_URL=https://dangdangvoice.vercel.app \
 node --env-file=.private/production.env server/ai-admin.mjs revoke-pro USER_EMAIL
```

owner 命令不创建/重置密码，不跳过邮箱验证，使用数据库事务锁与唯一管理员约束，并写审计。数据库迁移已有成功记录；下次变更先备份再按 release 程序显式迁移。

## 本轮检查范围

只构建、查看部署/容器日志、执行必要的新生产库迁移和最小 HTTP readiness。未运行测试套件、浏览器测试、基准或真实 AI 调用，未发送邮件。HTTP `/login`、`/healthz`、`/readyz`、`/api/auth/me`、`/api/auth/csrf` 返回 200；空登录 POST（正式 Origin + CSRF）到达参数校验返回 422；不可信 Origin 返回 403；未登录管理员接口返回 401。没有验证真实生产账户全流程、邮件或模型输出。

最终部署版本：`dpl_D948s9Kex8sePnDtyZiSXDRR9Knt`，可在 [部署日志](https://vercel.com/xiaoxigua/dangdangvoice/D948s9Kex8sePnDtyZiSXDRR9Knt) 查看。系统 CA 与 verify-full 更新后的 worker 数据库就绪日志及 1/1 ready 已确认。

## 比赛演示后的暂停命令

```bash
vercel daemons scale ai-worker sin1=0 --project dangdangvoice --scope xiaoxigua
```

这会停止整个 Daemon 实例，停止其分配内存消耗，保留 Web、数据库、用户、任务与报告。仅把 `AI_WORKER_ENABLED` 改为 false 不会停止实例内存计量。需要恢复时 `sin1=1`（此时仍会使用最新已部署的环境变量）。缩容覆盖会保留到后续部署，除非修改或 --reset。

本次 CLI `vercel billing usage --json --scope xiaoxigua` 返回当前计费周期的 usage/cost data unavailable（不能视为用量为零）。官方 Hobby 月配额仍为 420 GB-hours 内存、5 Active CPU-hours，当前实例分配 1 GiB / 1 vCPU，剩余实时额度未能从该 CLI 取得，需在账户 Usage 面板查看。没有升级或购买资源。

最新部署（SMTP / worker 启用）：`dpl_E2wouD3TWYH1gewExwRvAHSo7hr1`。Web 与 worker 的脱敏运行时摘要均确认 Gmail:465/TLS、真实 SMTP 模式、capture 关闭、发件人与认证地址一致、AI key 存在、北京端点与 qwen3.7-flash、worker enabled、生产 Neon 同库且 worker 直连；Daemon 1/1 ready，/readyz 返回 200。请求显式 enable_thinking=false、enable_search=false，不启用其他工具。未运行测试、浏览器测试、邮件发送或模型调用。

管理员命令可显式清除继承的数据库变量，避免终端环境覆盖指定的生产文件：

```bash
env -u DATABASE_URL -u WORKER_DATABASE_URL -u DDV_PROCESS_ROLE \
 NODE_ENV=production APP_BASE_URL=https://dangdangvoice.vercel.app \
 node --env-file=.private/production.env server/owner-admin.mjs \
 OWNER_EMAIL https://dangdangvoice.vercel.app
```
