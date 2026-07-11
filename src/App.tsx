import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Clipboard, Cloud, Copy, Download, FileUp, Link, LoaderCircle, Moon, Sun, Trash2, Upload, X } from "lucide-react";
import { api } from "./api";
import type { Snapshot } from "./types";

const EMPTY: Snapshot = { clips: [], files: [], storage: "连接中" };
const formatBytes = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : bytes < 1073741824 ? `${(bytes / 1048576).toFixed(1)} MB` : `${(bytes / 1073741824).toFixed(2)} GB`;
const remaining = (value: string) => { const ms = new Date(value).getTime() - Date.now(); return ms <= 0 ? "即将销毁" : ms < 3600000 ? `${Math.ceil(ms / 60000)} 分钟后` : `${Math.ceil(ms / 3600000)} 小时后`; };

export function App() {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const saved = localStorage.getItem("theme");
    return saved === "light" || saved === "dark" ? saved : matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  const [data, setData] = useState(EMPTY);
  const [text, setText] = useState("");
  const [status, setStatus] = useState("正在连接…");
  const [copied, setCopied] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [uploads, setUploads] = useState<Record<string, number>>({});
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => { document.documentElement.dataset.theme = theme; document.documentElement.style.colorScheme = theme; }, [theme]);
  const toggleTheme = () => setTheme((current) => { const next = current === "dark" ? "light" : "dark"; localStorage.setItem("theme", next); return next; });

  const refresh = useCallback(async () => { const next = await api.snapshot(); setData(next); setText(next.clips[0]?.content ?? ""); setStatus("已同步"); }, []);
  useEffect(() => { refresh().catch((e) => setStatus(e.message)); }, [refresh]);

  const save = (value: string) => {
    setText(value); setStatus("正在保存…"); window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => api.saveClip(value).then(refresh).catch((e) => setStatus(e.message)), 550);
  };
  const uploadFiles = async (files: File[]) => {
    for (const file of files) {
      setUploads((old) => ({ ...old, [file.name]: 0 }));
      try { await api.upload(file, (p) => setUploads((old) => ({ ...old, [file.name]: p }))); await refresh(); }
      catch (error) { setStatus(error instanceof Error ? error.message : "上传失败"); }
      finally { setUploads((old) => { const next = { ...old }; delete next[file.name]; return next; }); }
    }
  };
  useEffect(() => {
    const paste = (event: ClipboardEvent) => { const files = [...(event.clipboardData?.files ?? [])]; if (files.length) { event.preventDefault(); void uploadFiles(files); } };
    window.addEventListener("paste", paste); return () => window.removeEventListener("paste", paste);
  });

  return <main className="shell" onDragEnter={(e) => { e.preventDefault(); setDragging(true); }} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); setDragging(false); void uploadFiles([...e.dataTransfer.files]); }}>
    <header><div className="brand"><span className="logo"><Clipboard size={19}/></span><div><strong>云端剪切板</strong><small>临时、安全、跨设备</small></div></div><div className="header-actions"><button className="theme-toggle" onClick={toggleTheme} aria-label={`切换到${theme === "dark" ? "亮色" : "暗色"}模式`} title={`切换到${theme === "dark" ? "亮色" : "暗色"}模式`}>{theme === "dark" ? <Sun size={17}/> : <Moon size={17}/>}</button><div className="connection"><i/><span><b>云端已连接</b><small>{data.viewer ?? data.storage}</small></span></div></div></header>
    <section className="intro"><p>PRIVATE TRANSFER SPACE</p><h1>在设备之间，<em>轻轻放下。</em></h1><span>文本与文件将在 24 小时后自动销毁。</span></section>
    <div className="grid">
      <section className="card clip-card"><div className="card-title"><span><Clipboard size={18}/>临时剪切板</span><small>{status}</small></div><textarea value={text} onChange={(e) => save(e.target.value)} placeholder="在这里粘贴文本、链接或代码…"/>{data.clips.length > 1 && <div className="clip-history"><small>最近记录</small>{data.clips.slice(1).map((clip) => <button key={clip.id} title={clip.content} onClick={() => setText(clip.content)}><span>{clip.content.replace(/\s+/g, " ")}</span><time>{new Date(clip.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></button>)}</div>}<div className="clip-actions"><span>{text.length.toLocaleString()} 字符</span><button className="ghost" onClick={() => api.clearClips().then(refresh)}><Trash2 size={15}/>清空</button><button className="primary" onClick={async () => { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>{copied ? <Check size={16}/> : <Copy size={16}/>} {copied ? "已复制" : "复制"}</button></div></section>
      <section className="card files-card"><div className="card-title"><span><Cloud size={18}/>文件中转站</span><small>{data.files.length} 个文件</small></div>
        <label className={`dropzone ${dragging ? "active" : ""}`} onDragLeave={() => setDragging(false)}><input type="file" multiple onChange={(e) => void uploadFiles([...(e.target.files ?? [])])}/><span className="upload-icon"><Upload size={22}/></span><b>{dragging ? "松开即可上传" : "拖拽文件到这里"}</b><small>也可以点击选择，或直接粘贴截图</small></label>
        {Object.entries(uploads).map(([name, progress]) => <div className="uploading" key={name}><LoaderCircle size={18}/><span><b>{name}</b><i><em style={{width: `${progress * 100}%`}}/></i></span><small>{Math.round(progress * 100)}%</small></div>)}
        <div className="file-list">{data.files.length === 0 && <div className="empty"><FileUp size={25}/><span>还没有临时文件</span></div>}{data.files.map((file) => <article key={file.id}><span className="file-icon">{file.type.startsWith("image/") ? "IMG" : file.name.split(".").pop()?.slice(0, 3).toUpperCase() || "FILE"}</span><div className="file-meta"><b title={file.name}>{file.name}</b><small>{formatBytes(file.size)} · <em>{remaining(file.expiresAt)}销毁</em></small></div><div className="file-actions"><button title="复制下载链接" onClick={() => navigator.clipboard.writeText(new URL(api.downloadUrl(file.id), location.href).href)}><Link size={16}/></button><a title="下载" href={api.downloadUrl(file.id)}><Download size={16}/></a><button title="删除" onClick={() => api.deleteFile(file.id).then(refresh)}><X size={16}/></button></div></article>)}</div>
      </section>
    </div>
    <footer><span>私有临时存储</span><span>·</span><span>自动清理</span><span>·</span><span>无追踪</span></footer>
  </main>;
}
