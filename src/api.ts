import type { Snapshot } from "./types";

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  if (!response.ok) throw new ApiError((await response.json().catch(() => null))?.error ?? `请求失败 (${response.status})`, response.status);
  return response.json() as Promise<T>;
}

async function completeUpload(id: string) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await request(`/files/${id}/complete`, { method: "POST" });
      return;
    } catch (error) {
      if (attempt === 2 || (error instanceof ApiError && error.status < 500)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
}

export const api = {
  snapshot: () => request<Snapshot>("/snapshot"),
  saveClip: (content: string) => request<{ id: string }>("/clips", { method: "POST", body: JSON.stringify({ content }) }),
  updateClip: (id: string, content: string) => request<{ id: string }>(`/clips/${id}`, { method: "PATCH", body: JSON.stringify({ content }) }),
  deleteClip: (id: string) => request(`/clips/${id}`, { method: "DELETE" }),
  clearClips: () => request("/clips", { method: "DELETE" }),
  deleteFile: (id: string) => request(`/files/${id}`, { method: "DELETE" }),
  upload: async (file: File, onProgress: (value: number) => void) => {
    const ticket = await request<{ id: string; uploadUrl: string; method: "PUT"; headers?: Record<string, string> }>("/files/upload-ticket", {
      method: "POST", body: JSON.stringify({ name: file.name, size: file.size, type: file.type || "application/octet-stream" }),
    });
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(ticket.method, ticket.uploadUrl);
      Object.entries(ticket.headers ?? {}).forEach(([key, value]) => xhr.setRequestHeader(key, value));
      xhr.upload.onprogress = (event) => event.lengthComputable && onProgress(event.loaded / event.total);
      xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`上传失败 (${xhr.status})`));
      xhr.onerror = () => reject(new Error("网络连接中断"));
      xhr.send(file);
    });
    await completeUpload(ticket.id);
  },
  downloadUrl: (id: string) => `/api/files/${id}/download`,
};
