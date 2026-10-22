import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "./api";

describe("upload completion retries", () => {
  const puts: string[] = [];
  const ticket = { id: "same-ticket", uploadUrl: "https://upload.test/object", method: "PUT" };
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    puts.length = 0;
    fetchMock.mockReset();
    vi.useFakeTimers();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("XMLHttpRequest", class {
      upload = {};
      status = 200;
      onload?: () => void;
      open(method: string, url: string) { puts.push(`${method} ${url}`); }
      setRequestHeader() {}
      send() { this.onload?.(); }
    });
    fetchMock.mockResolvedValueOnce(Response.json(ticket));
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it.each(["network", "server"])("retries a %s failure using the same ticket without another PUT", async (failure) => {
    if (failure === "network") fetchMock.mockRejectedValueOnce(new TypeError("response lost"));
    else fetchMock.mockResolvedValueOnce(Response.json({ error: "temporary failure" }, { status: 503 }));
    fetchMock.mockResolvedValueOnce(Response.json({ ok: true }));

    const upload = api.upload(new File(["data"], "file.txt"), vi.fn());
    const result = upload.then(() => ({ ok: true }), (error: unknown) => ({ ok: false, error }));
    await vi.runAllTimersAsync();
    expect(await result).toEqual({ ok: true });

    expect(puts).toEqual(["PUT https://upload.test/object"]);
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      "/api/files/upload-ticket", "/api/files/same-ticket/complete", "/api/files/same-ticket/complete",
    ]);
  });

  it("stops after three completion attempts and preserves the final error", async () => {
    const failure = new TypeError("still offline");
    fetchMock.mockRejectedValue(failure);
    const upload = api.upload(new File(["data"], "file.txt"), vi.fn());
    const result = expect(upload).rejects.toBe(failure);
    await vi.runAllTimersAsync();
    await result;
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(puts).toHaveLength(1);
  });

  it.each([401, 404, 409])("does not retry permanent HTTP %i failures", async (status) => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: "cannot complete" }, { status }));
    await expect(api.upload(new File(["data"], "file.txt"), vi.fn())).rejects.toEqual(new ApiError("cannot complete", status));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(puts).toHaveLength(1);
  });
});
