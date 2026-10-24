# Data and API

## D1 schema

### `clips`

| Column | Meaning |
| --- | --- |
| `id` | Cryptographic UUID |
| `content` | Clipboard text |
| `created_at` | Unix seconds |
| `expires_at` | Unix seconds |

### `files`

| Column | Meaning |
| --- | --- |
| `id` | Cryptographic UUID |
| `object_key` | Unique private R2 key |
| `name` | Sanitized display name |
| `size` | Expected bytes |
| `content_type` | Signed upload content type |
| `status` | `pending` or `ready` |
| `created_at` | Unix seconds |
| `expires_at` | Unix seconds |

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/snapshot` | Return active clips, ready files, viewer, storage label |
| POST | `/api/clips` | Save text, reuse matching active history, and keep at most 20 records; reject blank text |
| PATCH | `/api/clips/:id` | Edit an active record and merge matching history atomically; return 404 for a missing or expired target |
| DELETE | `/api/clips` | Delete all clips |
| DELETE | `/api/clips/:id` | Delete one clip |
| POST | `/api/files/upload-ticket` | Create pending metadata and return signed PUT URL |
| POST | `/api/files/:id/complete` | Verify R2 object and mark ready |
| GET | `/api/files/:id/download` | Redirect to signed GET URL |
| DELETE | `/api/files/:id` | Delete D1 metadata and R2 object |

All JSON API responses use `cache-control: no-store`.

## Configuration

| Name | Type | Purpose |
| --- | --- | --- |
| `DB` | D1 binding | Metadata database |
| `FILES` | R2 binding | Private object bucket |
| `ASSETS` | Assets binding | Built SPA |
| `R2_ACCOUNT_ID` | var | S3 endpoint account |
| `R2_BUCKET_NAME` | var | Bucket used in signed URLs |
| `RETENTION_SECONDS` | var | Default 86400 |
| `MAX_FILE_BYTES` | var | Default 5 GiB |
| `R2_ACCESS_KEY_ID` | secret | Bucket-scoped S3 key ID |
| `R2_SECRET_ACCESS_KEY` | secret | Bucket-scoped S3 secret |

## Invariants

- Snapshot never returns `pending` or expired files.
- Completion never trusts the browser; it checks object existence and exact size.
- File names cannot create R2 path traversal.
- IDs and object paths use Web Crypto UUIDs.
- Database migrations are append-only after production application.
