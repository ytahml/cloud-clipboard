# Cloud Clipboard

一个部署在 Cloudflare Workers 上的私人临时剪切板与文件中转站。文本元数据存储在 D1，文件存储在私有 R2；浏览器使用 15 分钟有效的预签名 URL 直传和下载。

## 本地开发

```bash
npm install
cp .dev.vars.example .dev.vars
npm run cf:types
npm run cf:dev
```

首次运行前，需要在 `wrangler.jsonc` 中填写 D1 database ID 与 Cloudflare account ID，并为本地环境填写 R2 S3 API 凭据。

## Cloudflare 初始化

```bash
npx wrangler d1 create cloud-clipboard
npx wrangler r2 bucket create cloud-clipboard
npx wrangler r2 bucket cors set cloud-clipboard --file cloudflare/r2-cors.json
npx wrangler r2 bucket lifecycle add cloud-clipboard delete-after-one-day --expire-days 1
npx wrangler d1 migrations apply cloud-clipboard --remote
npx wrangler secret put R2_ACCESS_KEY_ID
npx wrangler secret put R2_SECRET_ACCESS_KEY
npm run build
npm run cf:deploy
```

复制 `cloudflare/r2-cors.example.json` 为 `cloudflare/r2-cors.json`，把示例域名替换成最终域名后再执行 CORS 命令。正式开放前，应在 Cloudflare Zero Trust 中用 Access 保护整个 Worker/域名。

## 安全边界

- R2 bucket 保持私有。
- 预签名 URL 仅存活 15 分钟。
- R2 API Token 只授予目标 bucket 的对象读写权限。
- Cloudflare Access 应覆盖页面和 `/api/*`，不要仅保护前端页面。
- D1 中的过期记录会在访问时异步清理；R2 生命周期规则是文件清理的最终保障。
