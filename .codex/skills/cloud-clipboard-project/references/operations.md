# Operations

## Current production

- Worker: `cloud-clipboard`
- URL: `<production origin configured outside Git>`
- D1 database: `cloud-clipboard`
- R2 bucket: `cloud-clipboard`
- Access allow email: `<Access identity configured outside Git>`
- R2 lifecycle: expire all objects after one day

Account and resource IDs are intentionally kept in `wrangler.jsonc`; they are identifiers, not credentials. Never copy secret values into this reference.

## Routine checks

```bash
npm run typecheck
npm run build
npx wrangler whoami
npx wrangler secret list
npx wrangler d1 migrations list cloud-clipboard --remote
npx wrangler r2 bucket cors list cloud-clipboard
npx wrangler r2 bucket lifecycle list cloud-clipboard
```

Expected secret names are `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`.

## Deploy

```bash
npm run cf:types
npm run typecheck
npm run build
npx wrangler deploy
```

After deployment, record the version ID in the handoff. Never infer that a successful asset upload means Access is configured; independently check an anonymous request returns an Access redirect.

## Safe production verification

1. Request the production root without credentials and expect an HTTP 302 to the account Access login hostname.
2. Ask the authorized user to log in normally; never request an OTP or Access cookie.
3. Use non-sensitive text and a small disposable file.
4. Query only clip lengths, timestamps, and file metadata when verifying D1; avoid clipboard contents.
5. A `ready` file proves the Worker successfully performed R2 `HEAD` and matched size.
6. Delete disposable test content when the task requires cleanup; otherwise confirm one-day expiry.

## CORS updates

Update `cloudflare/r2-cors.json` whenever the production origin changes, then run:

```bash
npx wrangler r2 bucket cors set cloud-clipboard --file cloudflare/r2-cors.json --force
npx wrangler r2 bucket cors list cloud-clipboard
```

Keep origins exact and avoid wildcard origins.

## Incident triage

- Access loop: verify application hostname, email selector, session duration, and policy precedence.
- Signing error: confirm the two secret names and that the R2 token is Object Read & Write scoped to this bucket.
- Browser CORS error: compare the browser Origin and Content-Type with the deployed CORS rule.
- Stuck pending upload: inspect Worker errors, R2 object existence, expected size, and token scope.
- Missing files after a day: expected lifecycle behavior.
- Expired D1 rows: snapshot requests schedule cleanup; verify timestamps before deleting manually.

Use `npx wrangler tail cloud-clipboard` only for a focused diagnostic window. Logs must not include clipboard bodies, signed URLs, secrets, or file content.
