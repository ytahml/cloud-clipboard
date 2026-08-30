import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestHarness } from "wrangler";

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
});
