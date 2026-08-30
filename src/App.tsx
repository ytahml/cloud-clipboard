import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Clipboard, Cloud, Copy, Download, FileUp, Link, LoaderCircle, Moon, ShieldCheck, Sun, Trash2, Upload, X } from "lucide-react";
import { api } from "./api";
import type { Snapshot } from "./types";

const EMPTY: Snapshot = { clips: [], files: [], storage: "连接中" };
const formatBytes = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : bytes < 1073741824 ? `${(bytes / 1048576).toFixed(1)} MB` : `${(bytes / 1073741824).toFixed(2)} GB`;
const remaining = (value: string) => { const ms = new Date(value).getTime() - Date.now(); return ms <= 0 ? "即将销毁" : ms < 3600000 ? `${Math.ceil(ms / 60000)} 分钟后` : `${Math.ceil(ms / 3600000)} 小时后`; };
const isErrorStatus = (status: string) => /失败|错误|超时|invalid|error/i.test(status);

export function App() {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const saved = localStorage.getItem("theme");
    return saved === "light" || saved === "dark" ? saved : matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  const [data, setData] = useState(EMPTY);
  const [text, setText] = useState("");
  const [status, setStatus] = useState("正在连接…");
  const [copied, setCopied] = useState(false);
  const [copiedLink, setCopiedLink] = useState<string>();
  const [dragging, setDragging] = useState(false);
  const [uploads, setUploads] = useState<Record<string, number>>({});
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => { document.documentElement.dataset.theme = theme; document.documentElement.style.colorScheme = theme; }, [theme]);
  const toggleTheme = () => setTheme((current) => { const next = current === "dark" ? "light" : "dark"; localStorage.setItem("theme", next); return next; });
  const refresh = useCallback(async () => { const next = await api.snapshot(); setData(next); setText(next.clips[0]?.content ?? ""); setStatus("已同步"); }, []);
  useEffect(() => { refresh().catch((error) => setStatus(error instanceof Error ? error.message : "连接失败")); }, [refresh]);

  const save = (value: string) => {
    setText(value); setStatus("正在保存…"); window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => api.saveClip(value).then(refresh).catch((error) => setStatus(error instanceof Error ? error.message : "保存失败")), 550);
  };
  const uploadFiles = async (files: File[]) => {
    for (const file of files) {
      setUploads((old) => ({ ...old, [file.name]: 0 }));
      try { await api.upload(file, (progress) => setUploads((old) => ({ ...old, [file.name]: progress }))); await refresh(); }
      catch (error) { setStatus(error instanceof Error ? error.message : "上传失败"); }
      finally { setUploads((old) => { const next = { ...old }; delete next[file.name]; return next; }); }
    }
  };
  useEffect(() => {
    const paste = (event: ClipboardEvent) => { const files = [...(event.clipboardData?.files ?? [])]; if (files.length) { event.preventDefault(); void uploadFiles(files); } };
    window.addEventListener("paste", paste); return () => window.removeEventListener("paste", paste);
  });

  const connected = status === "已同步";
  const connectionLabel = connected ? `云端已连接，${data.viewer ?? data.storage}` : isErrorStatus(status) ? `云端连接异常，${status}` : status;

  return <main className="shell" onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); setDragging(false); void uploadFiles([...event.dataTransfer.files]); }}>
    <header className="topbar">
      <div className="brand"><span className="logo" aria-hidden="true"><Clipboard size={20} /></span><div><strong>云端剪切板</strong><small>Cloud Clipboard</small></div></div>
      <div className="header-actions">
        <div className={`connection ${connected ? "is-online" : isErrorStatus(status) ? "is-error" : "is-pending"}`} role="status" aria-live="polite" aria-label={connectionLabel} title={connectionLabel}>
          <i aria-hidden="true" /><span className="connection-detail"><b>{connected ? "云端已连接" : isErrorStatus(status) ? "连接异常" : "正在连接"}</b><small>{connected ? data.viewer ?? data.storage : status}</small></span><b className="connection-compact">{connected ? "在线" : isErrorStatus(status) ? "异常" : "连接中"}</b>
        </div>
        <button className="icon-button theme-toggle" onClick={toggleTheme} aria-label={`切换到${theme === "dark" ? "亮色" : "暗色"}模式`} title={`切换到${theme === "dark" ? "亮色" : "暗色"}模式`}>{theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}</button>
      </div>
    </header>

    <section className="intro" aria-labelledby="page-title">
      <h1 id="page-title">文本和文件，<em>换台设备继续使用。</em></h1>
      <p className="intro-copy">文本自动同步，文件私密中转，所有内容会在 24 小时后清理。</p>
    </section>

    <div className="workspace-grid">
      <section className="card clip-card" aria-labelledby="clipboard-title">
        <div className="card-title"><span><span className="section-icon" aria-hidden="true"><Clipboard size={18} /></span><span><b id="clipboard-title">临时剪切板</b><small>输入后自动保存</small></span></span><small className={`sync-status ${isErrorStatus(status) ? "is-error" : ""}`} aria-live="polite">{status}</small></div>
        <label className="sr-only" htmlFor="clipboard-content">剪切板内容</label>
        <textarea id="clipboard-content" value={text} onChange={(event) => save(event.target.value)} placeholder="粘贴文本、链接或代码…" spellCheck="false" />
        {data.clips.length > 1 && <div className="clip-history" aria-label="最近记录"><small>最近记录</small>{data.clips.slice(1).map((clip) => <button key={clip.id} title={clip.content} onClick={() => setText(clip.content)}><span>{clip.content.replace(/\s+/g, " ")}</span><time>{new Date(clip.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></button>)}</div>}
        <div className="clip-actions">
          <span>{text.length.toLocaleString()} 字符</span>
          <button className="button button-ghost" disabled={data.clips.length === 0 && text.length === 0} onClick={() => api.clearClips().then(refresh)}><Trash2 size={16} />清空</button>
          <button className="button button-primary" disabled={!text} onClick={async () => { await navigator.clipboard.writeText(text); setCopied(true); window.setTimeout(() => setCopied(false), 1200); }}>{copied ? <Check size={17} /> : <Copy size={17} />}{copied ? "已复制" : "复制内容"}</button>
        </div>
      </section>

      <section className="card files-card" aria-labelledby="files-title">
        <div className="card-title"><span><span className="section-icon" aria-hidden="true"><Cloud size={18} /></span><span><b id="files-title">文件中转站</b><small>支持拖放与粘贴截图</small></span></span><small className="file-count">{data.files.length} 个文件</small></div>
        <label className={`dropzone ${dragging ? "active" : ""}`} onDragLeave={() => setDragging(false)}>
          <input type="file" multiple aria-label="选择要上传的文件" onChange={(event) => void uploadFiles([...(event.target.files ?? [])])} />
          <span className="upload-icon" aria-hidden="true"><Upload size={22} /></span><span className="dropzone-copy"><b>{dragging ? "松开，开始上传" : "拖放文件到这里"}</b><small><span>点击选择文件</span>，也可以直接粘贴截图</small></span>
        </label>
        <div className="transfer-list" aria-live="polite">
          {Object.entries(uploads).map(([name, progress]) => <div className="uploading" key={name}><LoaderCircle size={18} /><span><b>{name}</b><i><em style={{ width: `${progress * 100}%` }} /></i></span><small>{Math.round(progress * 100)}%</small></div>)}
          <div className="file-list">
            {data.files.length === 0 && Object.keys(uploads).length === 0 && <div className="empty"><span className="empty-icon" aria-hidden="true"><FileUp size={23} /></span><span><b>暂无临时文件</b><small>上传后，已授权设备都能访问</small></span></div>}
            {data.files.map((file) => <article key={file.id}>
              <span className="file-icon" aria-hidden="true">{file.type.startsWith("image/") ? "IMG" : file.name.split(".").pop()?.slice(0, 3).toUpperCase() || "FILE"}</span>
              <div className="file-meta"><b title={file.name}>{file.name}</b><small>{formatBytes(file.size)}<span>·</span><em>{remaining(file.expiresAt)}销毁</em></small></div>
              <div className="file-actions">
                <button aria-label={`复制 ${file.name} 的下载链接`} title="复制下载链接" onClick={async () => { await navigator.clipboard.writeText(new URL(api.downloadUrl(file.id), location.href).href); setCopiedLink(file.id); window.setTimeout(() => setCopiedLink(undefined), 1200); }}>{copiedLink === file.id ? <Check size={17} /> : <Link size={17} />}</button>
                <a aria-label={`下载 ${file.name}`} title="下载" href={api.downloadUrl(file.id)}><Download size={17} /></a>
                <button aria-label={`删除 ${file.name}`} title="删除" onClick={() => api.deleteFile(file.id).then(refresh)}><X size={17} /></button>
              </div>
            </article>)}
          </div>
        </div>
      </section>
    </div>

    <footer><span><ShieldCheck size={13} /> 私有访问</span><span>24 小时自动清理</span><span>文件私密存储</span></footer>
  </main>;
}
