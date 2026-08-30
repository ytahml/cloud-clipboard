import { AwsClient } from "aws4fetch";

type FileRow = { id: string; object_key: string; name: string; size: number; content_type: string; created_at: number; expires_at: number };
type ClipRow = { id: string; content: string; created_at: number; expires_at: number };

const CLIP_LIMIT = 20;

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const iso = (unix: number) => new Date(unix * 1000).toISOString();
const safeName = (name: string) => name.replace(/[\u0000-\u001f/\\]/g, "_").slice(0, 240) || "unnamed";

async function clipContent(request: Request): Promise<string | Response> {
  const body = await request.json<{ content?: unknown }>();
  if (typeof body.content !== "string") return json({ error: "文本格式无效" }, 400);
  if (!body.content.trim()) return json({ error: "文本不能为空" }, 400);
  if (new TextEncoder().encode(body.content).byteLength > 1_000_000) return json({ error: "文本不能超过 1 MB" }, 413);
  return body.content;
}

function config(env: Env) {
  return {
    retention: Number(env.RETENTION_SECONDS || "86400"),
    maxBytes: Number(env.MAX_FILE_BYTES || "5368709120"),
  };
}

function signer(env: Env) {
  if (!env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) throw new Error("R2 signing secrets are not configured");
  return new AwsClient({ accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY, service: "s3", region: "auto" });
}

async function signedUrl(env: Env, key: string, method: "GET" | "PUT", contentType?: string) {
  const url = new URL(`https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET_NAME}/${key.split("/").map(encodeURIComponent).join("/")}`);
  url.searchParams.set("X-Amz-Expires", "900");
  const headers = contentType ? { "content-type": contentType } : undefined;
  const signed = await signer(env).sign(url, { method, headers, aws: { signQuery: true } });
  return { url: signed.url, headers };
}

async function cleanup(env: Env, now: number, ctx: ExecutionContext) {
  const expired = await env.DB.prepare("SELECT object_key FROM files WHERE expires_at <= ? LIMIT 100").bind(now).all<{ object_key: string }>();
  ctx.waitUntil(Promise.all([
    ...expired.results.map((row) => env.FILES.delete(row.object_key)),
    env.DB.prepare("DELETE FROM files WHERE expires_at <= ?").bind(now).run(),
    env.DB.prepare("DELETE FROM clips WHERE expires_at <= ?").bind(now).run(),
  ]).then(() => undefined));
}

async function handleApi(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const now = Math.floor(Date.now() / 1000);
  await cleanup(env, now, ctx);

  if (path === "/api/snapshot" && request.method === "GET") {
    const [clips, files] = await Promise.all([
      env.DB.prepare("SELECT id, content, created_at, expires_at FROM clips WHERE expires_at > ? ORDER BY created_at DESC, rowid DESC LIMIT ?").bind(now, CLIP_LIMIT).all<ClipRow>(),
      env.DB.prepare("SELECT id, object_key, name, size, content_type, created_at, expires_at FROM files WHERE status = 'ready' AND expires_at > ? ORDER BY created_at DESC").bind(now).all<FileRow>(),
    ]);
    return json({
      clips: clips.results.map((row) => ({ id: row.id, content: row.content, createdAt: iso(row.created_at), expiresAt: iso(row.expires_at) })),
      files: files.results.map((row) => ({ id: row.id, name: row.name, size: row.size, type: row.content_type, createdAt: iso(row.created_at), expiresAt: iso(row.expires_at) })),
      viewer: request.headers.get("cf-access-authenticated-user-email") ?? undefined,
      storage: "Cloudflare R2",
    });
  }

  if (path === "/api/clips" && request.method === "POST") {
    const content = await clipContent(request);
    if (content instanceof Response) return content;
    const existing = await env.DB.prepare("SELECT id FROM clips WHERE content = ? AND expires_at > ? ORDER BY created_at DESC, rowid DESC LIMIT 1")
      .bind(content, now).first<{ id: string }>();
    if (existing) {
      await env.DB.batch([
        env.DB.prepare("INSERT OR REPLACE INTO clips (id, content, created_at, expires_at) VALUES (?, ?, ?, ?)").bind(existing.id, content, now, now + config(env).retention),
        env.DB.prepare("DELETE FROM clips WHERE content = ? AND id != ?").bind(content, existing.id),
      ]);
      return json({ id: existing.id });
    }
    const id = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO clips (id, content, created_at, expires_at) VALUES (?, ?, ?, ?)").bind(id, content, now, now + config(env).retention),
      env.DB.prepare("DELETE FROM clips WHERE id NOT IN (SELECT id FROM clips ORDER BY created_at DESC, rowid DESC LIMIT ?)").bind(CLIP_LIMIT),
    ]);
    return json({ id }, 201);
  }

  if (path === "/api/clips" && request.method === "DELETE") { await env.DB.prepare("DELETE FROM clips").run(); return json({ ok: true }); }

  const clip = path.match(/^\/api\/clips\/([^/]+)$/);
  if (clip && request.method === "PATCH") {
    const content = await clipContent(request);
    if (content instanceof Response) return content;
    const existing = await env.DB.prepare("SELECT id FROM clips WHERE content = ? AND id != ? AND expires_at > ? ORDER BY created_at DESC, rowid DESC LIMIT 1")
      .bind(content, clip[1], now).first<{ id: string }>();
    if (existing) {
      await env.DB.batch([
        env.DB.prepare("INSERT OR REPLACE INTO clips (id, content, created_at, expires_at) VALUES (?, ?, ?, ?)").bind(existing.id, content, now, now + config(env).retention),
        env.DB.prepare("DELETE FROM clips WHERE id = ? OR (content = ? AND id != ?)").bind(clip[1], content, existing.id),
      ]);
      return json({ id: existing.id });
    }
    const result = await env.DB.prepare("UPDATE clips SET content = ?, expires_at = ? WHERE id = ? AND expires_at > ?")
      .bind(content, now + config(env).retention, clip[1], now).run();
    if (result.meta.changes === 0) return json({ error: "剪切板记录不存在或已过期" }, 404);
    return json({ id: clip[1] });
  }
  if (clip && request.method === "DELETE") {
    const result = await env.DB.prepare("DELETE FROM clips WHERE id = ?").bind(clip[1]).run();
    if (result.meta.changes === 0) return json({ error: "剪切板记录不存在" }, 404);
    return json({ ok: true });
  }

  if (path === "/api/files/upload-ticket" && request.method === "POST") {
    const body = await request.json<{ name?: unknown; size?: unknown; type?: unknown }>();
    if (typeof body.name !== "string" || typeof body.size !== "number" || body.size < 0 || typeof body.type !== "string") return json({ error: "文件信息无效" }, 400);
    if (body.size > config(env).maxBytes) return json({ error: "文件超过允许的大小" }, 413);
    const id = crypto.randomUUID();
    const name = safeName(body.name);
    const key = `${new Date().toISOString().slice(0, 10)}/${id}/${name}`;
    await env.DB.prepare("INSERT INTO files (id, object_key, name, size, content_type, status, created_at, expires_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)")
      .bind(id, key, name, body.size, body.type, now, now + config(env).retention).run();
    const signed = await signedUrl(env, key, "PUT", body.type);
    return json({ id, uploadUrl: signed.url, method: "PUT", headers: signed.headers }, 201);
  }

  const complete = path.match(/^\/api\/files\/([^/]+)\/complete$/);
  if (complete && request.method === "POST") {
    const row = await env.DB.prepare("SELECT object_key, size FROM files WHERE id = ? AND status = 'pending'").bind(complete[1]).first<{ object_key: string; size: number }>();
    if (!row) return json({ error: "上传任务不存在" }, 404);
    const object = await env.FILES.head(row.object_key);
    if (!object || object.size !== row.size) return json({ error: "文件尚未完整上传" }, 409);
    await env.DB.prepare("UPDATE files SET status = 'ready' WHERE id = ?").bind(complete[1]).run();
    return json({ ok: true });
  }

  const download = path.match(/^\/api\/files\/([^/]+)\/download$/);
  if (download && request.method === "GET") {
    const row = await env.DB.prepare("SELECT object_key, name, content_type FROM files WHERE id = ? AND status = 'ready' AND expires_at > ?").bind(download[1], now).first<{ object_key: string; name: string; content_type: string }>();
    if (!row) return json({ error: "文件不存在或已过期" }, 404);
    const signed = await signedUrl(env, row.object_key, "GET");
    return Response.redirect(signed.url, 302);
  }

  const remove = path.match(/^\/api\/files\/([^/]+)$/);
  if (remove && request.method === "DELETE") {
    const row = await env.DB.prepare("SELECT object_key FROM files WHERE id = ?").bind(remove[1]).first<{ object_key: string }>();
    if (!row) return json({ error: "文件不存在" }, 404);
    await Promise.all([env.FILES.delete(row.object_key), env.DB.prepare("DELETE FROM files WHERE id = ?").bind(remove[1]).run()]);
    return json({ ok: true });
  }

  return json({ error: "接口不存在" }, 404);
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    try {
      if (new URL(request.url).pathname.startsWith("/api/")) return await handleApi(request, env, ctx);
      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error(JSON.stringify({ event: "request_failed", path: new URL(request.url).pathname, error: error instanceof Error ? error.message : String(error) }));
      return json({ error: "服务器处理请求失败" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
