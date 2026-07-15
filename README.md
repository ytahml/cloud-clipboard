# Cloud Clipboard / 云端剪切板

[中文](#中文) · [English](#english)

一个部署在 Cloudflare Workers 上的私人跨设备剪切板与临时文件中转站。文本和文件元数据存储在 D1，文件存储在私有 R2；浏览器通过短时预签名 URL 直接上传和下载文件。

A private cross-device clipboard and temporary file transfer app built on Cloudflare Workers. Clipboard and file metadata live in D1, while file objects stay in a private R2 bucket and move through short-lived presigned URLs.

## 中文

### 功能

- 最近 3 条文本记录，输入后自动同步
- 文件选择、拖拽和粘贴上传
- 上传进度、下载、复制链接和手动删除
- 文本与文件默认 24 小时后过期
- R2 私有存储及 15 分钟预签名 URL
- Cloudflare Access 邮箱准入
- 自动识别系统主题，并支持亮色/暗色切换
- 桌面双栏、移动端单栏响应式界面

### 架构

```text
Browser
  │
  ├─ Cloudflare Access ─ Worker API ─ D1 (文本和文件元数据)
  │                         │
  └─ R2 presigned URL ──────┴─────── R2 (私有文件对象)
```

Worker 只签发短时上传/下载 URL，并在上传完成后通过 R2 Binding 检查对象大小。大文件数据不经过 Worker。

### 环境要求

- Node.js 20 或更新版本
- npm 10 或更新版本
- Cloudflare 账号
- 已启用 Workers、D1、R2 和 Zero Trust Access

### 本地快速运行

```bash
git clone https://github.com/ytahml/cloud-clipboard.git
cd cloud-clipboard
npm install
cp .dev.vars.example .dev.vars
npx wrangler d1 migrations apply cloud-clipboard --local
npm run build
npm run cf:dev
```

打开 <http://localhost:8787>。

默认 `.dev.vars` 只有占位值。本地文本和界面调试不需要真实 R2 凭据；若要连接真实 R2 测试文件上传，请在 `.dev.vars` 中填写仅限测试 Bucket 的凭据，且不要提交该文件。

### Cloudflare 快速部署

如果希望完全通过 Cloudflare 控制台部署，请使用 GitHub Actions 生成的 Pages Direct Upload ZIP，并按[界面部署指南](docs/cloudflare-dashboard-deployment.zh-CN.md)操作。ZIP 只包含预构建代码；D1、R2、Secrets、CORS 和 Access 仍需在控制台逐项配置。

#### 1. 登录并创建资源

```bash
npx wrangler login
npx wrangler d1 create cloud-clipboard
npx wrangler r2 bucket create cloud-clipboard
```

将命令输出的 D1 `database_id` 和 Cloudflare Account ID 填入 `wrangler.jsonc`：

```jsonc
{
  "d1_databases": [{
    "binding": "DB",
    "database_name": "cloud-clipboard",
    "database_id": "YOUR_D1_DATABASE_ID"
  }],
  "vars": {
    "R2_ACCOUNT_ID": "YOUR_CLOUDFLARE_ACCOUNT_ID"
  }
}
```

仓库配置使用占位 ID；部署前必须替换为当前 Cloudflare 账号与 D1 数据库的实际 ID。

#### 2. 初始化数据库和生命周期

```bash
npm run cf:types
npx wrangler d1 migrations apply cloud-clipboard --remote
npx wrangler r2 bucket lifecycle add cloud-clipboard delete-after-one-day --expire-days 1
```

#### 3. 首次部署

```bash
npm run build
npx wrangler deploy
```

记下输出的 `https://<worker>.<subdomain>.workers.dev` 地址。首次部署后立即在 Cloudflare Zero Trust 中创建 Access Self-hosted Application，保护整个 Worker，并将 Allow 策略限制到受信任邮箱。Access 生效前不要写入敏感内容。

#### 4. 配置 R2 CORS

复制示例并将来源替换为每个实际使用的浏览器 Origin。生成的 `cloudflare/r2-cors.json` 是包含环境专属域名的本地文件，已被 Git 忽略，不要提交：

```bash
cp cloudflare/r2-cors.example.json cloudflare/r2-cors.json
npx wrangler r2 bucket cors set cloud-clipboard --file cloudflare/r2-cors.json
npx wrangler r2 bucket cors list cloud-clipboard
```

Origin 必须是精确的 `scheme://host[:port]`，不能包含路径或结尾 `/`。

#### 5. 配置 R2 S3 凭据

在 Cloudflare Dashboard 的 R2 API Tokens 中创建凭据：

- 权限：`Object Read & Write`
- 范围：仅 `cloud-clipboard` Bucket

然后执行：

```bash
npx wrangler secret put R2_ACCESS_KEY_ID
npx wrangler secret put R2_SECRET_ACCESS_KEY
npx wrangler secret list
npx wrangler deploy
```

`secret list` 应显示上述两个变量名。Secret Access Key 只会显示一次，不要写入代码、`wrangler.jsonc`、Issue 或聊天记录。

### 验证

```bash
npm run typecheck
npm run build
npx wrangler d1 migrations list cloud-clipboard --remote
npx wrangler r2 bucket lifecycle list cloud-clipboard
npx wrangler r2 bucket cors list cloud-clipboard
```

线上验收：

1. 未登录访问应跳转到 Cloudflare Access。
2. 登录后保存 3 条文本，刷新页面后仍按新到旧显示。
3. 上传一个无敏感内容的小文件，确认进度结束且文件进入列表。
4. 下载文件并核对内容。
5. 删除文件并确认列表更新。

### 常见问题

- `assets.directory does not exist`：先运行 `npm run build`。
- R2 API `10042`：先在 Cloudflare Dashboard 启用 R2。
- 浏览器上传返回 CORS 错误：核对 `AllowedOrigins`、`PUT` 和 `Content-Type`。
- 上传任务一直是 `pending`：检查 R2 Secret、Bucket 范围和对象大小；过期记录会被清理。
- 上传接口提示签名凭据未配置：运行 `wrangler secret list`，确认变量名完全正确。
- Access 配置完成但 API 仍公开：确保 Access 覆盖整个 Worker，而不是单个页面路径。

### 安全说明

- R2 Bucket 必须保持私有。
- 预签名 URL 是临时 bearer token，默认有效期 15 分钟。
- 文件删除以 R2 生命周期为最终保障，D1 过期数据由访问时清理处理。
- 应用不是端到端加密工具；不要将“私有临时存储”理解为客户端加密。
- 不要提交 `.dev.vars`、`.env`、Wrangler 本地状态或真实密钥。

## English

### Features

- Keep the three most recent clipboard entries with automatic sync
- Upload files by picker, drag and drop, or clipboard paste
- Show progress; download, copy links, and delete files
- Expire clipboard entries and files after 24 hours by default
- Keep R2 private and issue 15-minute presigned URLs
- Protect the whole app with Cloudflare Access
- Follow the system theme on first visit and allow light/dark switching
- Responsive two-column desktop and single-column mobile layout

### Local development

```bash
git clone https://github.com/ytahml/cloud-clipboard.git
cd cloud-clipboard
npm install
cp .dev.vars.example .dev.vars
npx wrangler d1 migrations apply cloud-clipboard --local
npm run build
npm run cf:dev
```

Open <http://localhost:8787>. Placeholder R2 credentials are sufficient for UI and clipboard development. Use bucket-scoped test credentials in `.dev.vars` only when testing real R2 uploads, and never commit that file.

### Cloudflare deployment

1. Authenticate and create resources:

   ```bash
   npx wrangler login
   npx wrangler d1 create cloud-clipboard
   npx wrangler r2 bucket create cloud-clipboard
   ```

2. Replace the account-specific `database_id` and `R2_ACCOUNT_ID` values in `wrangler.jsonc`.

3. Generate bindings, migrate D1, and configure object expiry:

   ```bash
   npm run cf:types
   npx wrangler d1 migrations apply cloud-clipboard --remote
   npx wrangler r2 bucket lifecycle add cloud-clipboard delete-after-one-day --expire-days 1
   ```

4. Build and deploy once to obtain the production hostname:

   ```bash
   npm run build
   npx wrangler deploy
   ```

5. Immediately protect the entire Worker with a Cloudflare Access Self-hosted Application and an email-restricted Allow policy.

6. Copy `cloudflare/r2-cors.example.json` to the Git-ignored local file `cloudflare/r2-cors.json`, replace its origins with every browser origin actually in use, and apply it. Do not commit the generated environment-specific file:

   ```bash
   npx wrangler r2 bucket cors set cloud-clipboard --file cloudflare/r2-cors.json
   npx wrangler r2 bucket cors list cloud-clipboard
   ```

7. Create an R2 API token with `Object Read & Write` access scoped only to the project bucket, then set both Worker secrets:

   ```bash
   npx wrangler secret put R2_ACCESS_KEY_ID
   npx wrangler secret put R2_SECRET_ACCESS_KEY
   npx wrangler secret list
   npx wrangler deploy
   ```

### Production checks

```bash
npm run typecheck
npm run build
npx wrangler d1 migrations list cloud-clipboard --remote
npx wrangler r2 bucket lifecycle list cloud-clipboard
npx wrangler r2 bucket cors list cloud-clipboard
```

Confirm that anonymous traffic is redirected to Access, clipboard history survives a refresh, file upload reaches `ready`, downloads succeed, and deletion updates both metadata and object storage.

### Project knowledge skill

Agents working in this repository should load:

```text
.codex/skills/cloud-clipboard-project/SKILL.md
```

It contains the maintenance workflow and routes agents to architecture, operations, and schema references without exposing secrets.

## License

This project is available under the [MIT License](LICENSE).

本项目采用 [MIT 开源协议](LICENSE)。
