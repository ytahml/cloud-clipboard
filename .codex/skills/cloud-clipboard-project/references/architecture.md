# Architecture

## Product scope

Cloud Clipboard is a private, temporary, shared transfer space for authorized users. The first release uses one shared workspace for every email allowed by Cloudflare Access. It stores the three newest clipboard entries and temporary files for 24 hours.

## Components

| Component | Responsibility |
| --- | --- |
| React + Vite | Responsive SPA, clipboard editing, theme, upload progress |
| Cloudflare Access | Authentication and email allow policy for all routes |
| Worker | API validation, D1 metadata, R2 signing and completion checks |
| D1 | Clipboard records and file metadata |
| Private R2 | File object bodies |
| R2 lifecycle | Final deletion of objects after one day |

## Request flows

### Clipboard

1. UI debounces edits for 550 ms.
2. `POST /api/clips` validates a string payload and limits UTF-8 size to 1 MB.
3. Worker inserts a row with a 24-hour expiry.
4. Worker retains only the newest three rows.
5. `GET /api/snapshot` filters expired rows and returns newest first.

### Upload

1. UI sends name, byte size, and MIME type to `POST /api/files/upload-ticket`.
2. Worker sanitizes the name, enforces the configurable size limit, inserts a `pending` row, and signs a 15-minute R2 PUT URL.
3. Browser uploads directly to R2 with XHR so progress is observable.
4. UI calls `POST /api/files/:id/complete`.
5. Worker uses the R2 binding to `HEAD` the object and compare its size before setting `ready`.

### Download

1. Browser requests `/api/files/:id/download` through Access.
2. Worker verifies ready state and expiry.
3. Worker redirects to a short-lived R2 GET URL.

## Portability direction

VPS support is deferred. Preserve API and storage boundaries so D1 can later map to SQLite and R2 to local disk or S3-compatible storage. Do not introduce Cloudflare-specific calls into React components.

## UI principles

- Keep the interface visually quiet, compact, and touch friendly.
- Follow the system color scheme on first visit and persist explicit theme choices.
- Preserve desktop two-column and mobile single-column layouts.
- State labels must distinguish connecting, saving, synced, uploading, and failures.
