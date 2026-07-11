import type { Snapshot } from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? `请求失败 (${response.status})`);
  return response.json() as Promise<T>;
}

export const api = {
  snapshot: () => request<Snapshot>("/snapshot"),
  saveClip: (content: string) => request("/clips", { method: "POST", body: JSON.stringify({ content }) }),
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
    await request(`/files/${ticket.id}/complete`, { method: "POST" });
  },
  downloadUrl: (id: string) => `/api/files/${id}/download`,
};
