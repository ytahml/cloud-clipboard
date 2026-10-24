import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestHarness } from "wrangler";
import handler from "./index.js";

const server = createTestHarness({ workers: [{ configPath: "./wrangler.jsonc" }] });
const worker = server.getWorker<Env>();

async function saveClip(content: string) {
  const response = await worker.fetch("http://clipboard.test/api/clips", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content }),
  });
  const body = await response.json() as { id: string };
  return { response, body };
}

async function snapshot() {
  const response = await worker.fetch("http://clipboard.test/api/snapshot");
  return response.json() as Promise<{ clips: Array<{ id: string; content: string }> }>;
}

function interleaveDuplicateReads(database: D1Database): D1Database {
  // Hold standalone duplicate reads until both requests have observed the same state.
  // Keep each native D1 batch intact so the test preserves transaction semantics.
  let reads = 0, releaseReads: () => void = () => {};
  const bothReads = new Promise<void>((resolve) => { releaseReads = resolve; });
  const originals = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
  function wrapStatement(statement: D1PreparedStatement, sql: string): D1PreparedStatement {
    const wrapped = new Proxy(statement, { get(target, property) {
      if (property === "bind") return (...values: unknown[]) => wrapStatement(target.bind(...values), sql);
      if (property === "first" && sql.startsWith("SELECT id FROM clips WHERE content =")) return async () => {
        const result = await target.first();
        if (++reads === 2) releaseReads();
        await bothReads;
        return result;
      };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    originals.set(wrapped, statement);
    return wrapped;
  }
  return new Proxy(database, { get(target, property) {
    if (property === "prepare") return (sql: string) => wrapStatement(target.prepare(sql), sql);
    if (property === "batch") return (statements: D1PreparedStatement[]) => target.batch(statements.map((statement) => originals.get(statement) ?? statement));
    const value = Reflect.get(target, property);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}

describe("clipboard HTTP API", () => {
  beforeAll(async () => { await server.listen(); });
  beforeEach(async () => {
    await server.reset();
    await worker.applyD1Migrations("DB");
  });
  afterAll(async () => { await server.close(); });

  it("keeps the twenty newest clipboard records", async () => {
    for (let index = 1; index <= 21; index += 1) {
      const { response } = await saveClip(`clip-${index}`);
      expect(response.status).toBe(201);
    }

    const result = await snapshot();
    expect(result.clips).toHaveLength(20);
    expect(result.clips[0]?.content).toBe("clip-21");
    expect(result.clips.at(-1)?.content).toBe("clip-2");
  });

  it("updates the active record without creating an edit-history trail", async () => {
    const created = await saveClip("first draft");
    const response = await worker.fetch(`http://clipboard.test/api/clips/${created.body.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "finished text" }),
    });

    expect(response.status).toBe(200);
    const result = await snapshot();
    expect(result.clips).toEqual([
      expect.objectContaining({ id: created.body.id, content: "finished text" }),
    ]);
  });

  it("moves matching content to the front instead of creating a duplicate", async () => {
    const first = await saveClip("repeat me");
    await saveClip("something else");
    const repeated = await saveClip("repeat me");

    expect(repeated.body.id).toBe(first.body.id);
    const result = await snapshot();
    expect(result.clips).toHaveLength(2);
    expect(result.clips[0]?.content).toBe("repeat me");
  });

  it("keeps distinct history when overlapping requests save the same new text", async () => {
    for (let index = 1; index <= 19; index += 1) await saveClip(`history-${index}`);
    const env = await worker.getEnv();
    const DB = interleaveDuplicateReads(env.DB);
    const background: Promise<unknown>[] = [];
    const ctx = {
      waitUntil: (promise: Promise<unknown>) => { background.push(promise); }, passThroughOnException() {}, props: {},
      get exports(): ExecutionContext["exports"] { throw new Error("unexpected exports access"); },
      get tracing(): ExecutionContext["tracing"] { throw new Error("unexpected tracing access"); },
    } satisfies ExecutionContext;
    const saves = await Promise.all(Array.from({ length: 2 }, async () => {
      const request = new Request("http://clipboard.test/api/clips", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: "shared text" }),
      });
      // Node's Request has no Workers cf metadata; this handler uses standard fields only.
      const response = await handler.fetch(request as Parameters<typeof handler.fetch>[0], { ...env, DB }, ctx);
      return { response, body: await response.json() as { id: string } };
    }));
    await Promise.all(background);

    expect(new Set(saves.map(({ body }) => body.id)).size).toBe(1);
    expect(saves.filter(({ response }) => response.status === 201)).toHaveLength(1);
    const result = await snapshot();
    expect(result.clips).toHaveLength(20);
    expect(new Set(result.clips.map(({ content }) => content)).size).toBe(20);
    expect(result.clips.at(-1)?.content).toBe("history-1");
  });

  it("removes old duplicates before applying the history limit", async () => {
    const { DB } = await worker.getEnv();
    const now = Math.floor(Date.now() / 1000);
    for (let index = 1; index <= 19; index += 1) await saveClip(`history-${index}`);
    await DB.batch(["old-copy", "new-copy"].map((id, index) => DB.prepare(
      "INSERT INTO clips (id, content, created_at, expires_at) VALUES (?, ?, ?, ?)",
    ).bind(id, "shared text", now + index, now + 86400)));

    const saved = await saveClip("shared text");
    expect(saved.body.id).toBe("new-copy");
    expect(saved.response.status).toBe(200);
    const result = await snapshot();
    expect(result.clips).toHaveLength(20);
    expect(new Set(result.clips.map(({ content }) => content)).size).toBe(20);
    expect(result.clips.some(({ content }) => content === "history-1")).toBe(true);
  });

  it("deduplicates when the active record is edited to match history", async () => {
    const history = await saveClip("same content");
    const active = await saveClip("different content");
    const response = await worker.fetch(`http://clipboard.test/api/clips/${active.body.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "same content" }),
    });
    const body = await response.json() as { id: string };

    expect(body.id).toBe(history.body.id);
    const result = await snapshot();
    expect(result.clips).toEqual([
      expect.objectContaining({ id: history.body.id, content: "same content" }),
    ]);
  });

  for (const target of ["missing", "expired"] as const) {
    it(`rejects a ${target} edit target without refreshing matching history`, async () => {
      const { DB } = await worker.getEnv();
      const now = Math.floor(Date.now() / 1000);
      await DB.prepare("INSERT INTO clips (id, content, created_at, expires_at) VALUES (?, ?, ?, ?)")
        .bind("history", "same content", now - 20, now + 60).run();
      if (target === "expired") {
        await DB.prepare("INSERT INTO clips (id, content, created_at, expires_at) VALUES (?, ?, ?, ?)")
          .bind("target", "old draft", now - 20, now - 1).run();
      }
      const before = await DB.prepare("SELECT * FROM clips WHERE id = ?").bind("history").first();
      const response = await worker.fetch("http://clipboard.test/api/clips/target", {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: "same content" }),
      });
      expect(response.status).toBe(404);
      expect(await DB.prepare("SELECT * FROM clips WHERE id = ?").bind("history").first()).toEqual(before);
    });
  }

  it("merges overlapping edits to the same content in one transaction", async () => {
    const first = await saveClip("first draft");
    const second = await saveClip("second draft");
    const env = await worker.getEnv();
    const DB = interleaveDuplicateReads(env.DB);
    const background: Promise<unknown>[] = [];
    const ctx = {
      waitUntil: (promise: Promise<unknown>) => { background.push(promise); }, passThroughOnException() {}, props: {},
      get exports(): ExecutionContext["exports"] { throw new Error("unexpected exports access"); },
      get tracing(): ExecutionContext["tracing"] { throw new Error("unexpected tracing access"); },
    } satisfies ExecutionContext;
    const edits = await Promise.all([first.body.id, second.body.id].map(async (id) => {
      const request = new Request(`http://clipboard.test/api/clips/${id}`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: "shared text" }),
      });
      const response = await handler.fetch(request as Parameters<typeof handler.fetch>[0], { ...env, DB }, ctx);
      return { response, body: await response.json() as { id: string } };
    }));
    await Promise.all(background);
    expect(edits.map(({ response }) => response.status)).toEqual([200, 200]);
    expect(new Set(edits.map(({ body }) => body.id)).size).toBe(1);
    expect((await snapshot()).clips).toEqual([
      expect.objectContaining({ id: edits[0].body.id, content: "shared text" }),
    ]);
  });

  it("deletes one clipboard record without clearing the rest", async () => {
    const removed = await saveClip("remove me");
    await saveClip("keep me");
    const response = await worker.fetch(`http://clipboard.test/api/clips/${removed.body.id}`, { method: "DELETE" });

    expect(response.status).toBe(200);
    const result = await snapshot();
    expect(result.clips.map((clip) => clip.content)).toEqual(["keep me"]);
  });

  it("does not treat an empty save as a clear-all command", async () => {
    await saveClip("keep me");
    const response = await worker.fetch("http://clipboard.test/api/clips", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "   " }),
    });

    expect(response.status).toBe(400);
    const result = await snapshot();
    expect(result.clips.map((clip) => clip.content)).toEqual(["keep me"]);
  });

  async function pendingFile(expiresAt = Math.floor(Date.now() / 1000) + 86400) {
    const env = await worker.getEnv();
    await env.DB.prepare("INSERT INTO files (id, object_key, name, size, content_type, status, created_at, expires_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)")
      .bind("file-id", "test/file", "file.txt", 4, "text/plain", expiresAt - 86400, expiresAt).run();
    return env;
  }

  const completeFile = () => worker.fetch("http://clipboard.test/api/files/file-id/complete", { method: "POST" });

  it("replays completion without duplicating the file or extending retention", async () => {
    const { DB, FILES } = await pendingFile();
    await FILES.put("test/file", "data");
    const before = await DB.prepare("SELECT expires_at FROM files WHERE id = 'file-id'").first();

    expect((await completeFile()).status).toBe(200);
    expect((await completeFile()).status).toBe(200);
    expect(await DB.prepare("SELECT status, expires_at FROM files").all()).toMatchObject({
      results: [{ status: "ready", ...before }],
    });
  });

  it("still checks object existence and size when completing or replaying a file", async () => {
    const { FILES } = await pendingFile();
    expect((await completeFile()).status).toBe(409);
    await FILES.put("test/file", "wrong size");
    expect((await completeFile()).status).toBe(409);
    await FILES.put("test/file", "data");
    expect((await completeFile()).status).toBe(200);
    await FILES.delete("test/file");
    expect((await completeFile()).status).toBe(409);
  });

  it("does not complete an expired upload", async () => {
    const { FILES } = await pendingFile(Math.floor(Date.now() / 1000) - 1);
    await FILES.put("test/file", "data");
    expect((await completeFile()).status).toBe(404);
  });
});
