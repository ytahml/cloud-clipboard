import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Clipboard, Cloud, Copy, Download, FileUp, Link, LoaderCircle, Moon, MoreHorizontal, Plus, RotateCcw, ShieldCheck, Sun, Trash2, Upload, X } from "lucide-react";
import { ApiError, api } from "./api";
import type { Clip, Snapshot } from "./types";

const EMPTY: Snapshot = { clips: [], files: [], storage: "连接中" };
const RETRY_DELAY = 2_000;
const SAVE_DELAY = 550;
const UNDO_DELAY = 5_000;

type EditorMode = "new" | "draft" | "saved" | "history" | "expired";
type PendingDelete = { clip: Clip; timer: number };

const formatBytes = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : bytes < 1073741824 ? `${(bytes / 1048576).toFixed(1)} MB` : `${(bytes / 1073741824).toFixed(2)} GB`;
const remaining = (value: string) => { const ms = new Date(value).getTime() - Date.now(); return ms <= 0 ? "即将销毁" : ms < 3600000 ? `${Math.ceil(ms / 60000)} 分钟后` : `${Math.ceil(ms / 3600000)} 小时后`; };
const isErrorStatus = (status: string) => /失败|错误|超时|未同步|invalid|error/i.test(status);
const compactText = (content: string) => content.replace(/\s+/g, " ").trim();
const formatClipTime = (value: string) => {
  const date = new Date(value);
  const today = new Date();
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return date.toDateString() === today.toDateString() ? time : `${date.toLocaleDateString([], { month: "numeric", day: "numeric" })} ${time}`;
};

export function App() {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const saved = localStorage.getItem("theme");
    return saved === "light" || saved === "dark" ? saved : matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  const [data, setData] = useState(EMPTY);
  const [text, setText] = useState("");
  const [status, setStatus] = useState("正在连接…");
  const [connected, setConnected] = useState(false);
  const [editorMode, setEditorModeState] = useState<EditorMode>("new");
  const [selectedId, setSelectedIdState] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [copiedClip, setCopiedClip] = useState<string>();
  const [copiedLink, setCopiedLink] = useState<string>();
  const [dragging, setDragging] = useState(false);
  const [uploads, setUploads] = useState<Record<string, number>>({});
  const [remoteNotice, setRemoteNotice] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Clip>();
  const [confirmClear, setConfirmClear] = useState(false);
  const [openMenu, setOpenMenu] = useState<string>();

  const initialized = useRef(false);
  const newestId = useRef<string | undefined>(undefined);
  const selectedIdRef = useRef<string | undefined>(undefined);
  const activeIdRef = useRef<string | undefined>(undefined);
  const editorModeRef = useRef<EditorMode>("new");
  const forkedFromHistory = useRef(false);
  const pendingDraft = useRef<string | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const retryTimer = useRef<number | undefined>(undefined);
  const savePromise = useRef<Promise<boolean> | null>(null);
  const persistRef = useRef<() => Promise<boolean>>(async () => true);
  const pendingDeleteRef = useRef<PendingDelete | undefined>(undefined);
  const clearTimer = useRef<number | undefined>(undefined);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const setEditorMode = (mode: EditorMode) => { editorModeRef.current = mode; setEditorModeState(mode); };
  const setSelectedId = (id?: string) => { selectedIdRef.current = id; setSelectedIdState(id); };

  useEffect(() => { document.documentElement.dataset.theme = theme; document.documentElement.style.colorScheme = theme; }, [theme]);
  const toggleTheme = () => setTheme((current) => { const next = current === "dark" ? "light" : "dark"; localStorage.setItem("theme", next); return next; });

  const applySnapshot = useCallback((next: Snapshot, announceRemote = false) => {
    const previousNewest = newestId.current;
    setData(next);
    setConnected(true);

    if (!initialized.current) {
      initialized.current = true;
      const latest = next.clips[0];
      if (latest) {
        setText(latest.content);
        setSelectedId(latest.id);
        setEditorMode("history");
        setStatus("正在查看最新记录");
      } else {
        setEditorMode("new");
        setStatus("已同步");
      }
    } else {
      const trackedId = activeIdRef.current ?? selectedIdRef.current;
      if (trackedId && !next.clips.some((clip) => clip.id === trackedId) && pendingDeleteRef.current?.clip.id !== trackedId) {
        activeIdRef.current = undefined;
        setSelectedId(undefined);
        setEditorMode("expired");
        setStatus("云端记录已过期，当前文本仍可复制或另存");
      }
      const nextNewest = next.clips[0]?.id;
      if (announceRemote && nextNewest && nextNewest !== previousNewest && nextNewest !== activeIdRef.current) setRemoteNotice(true);
    }
    newestId.current = next.clips[0]?.id;
  }, []);

  const refresh = useCallback(async (announceRemote = false) => {
    try { applySnapshot(await api.snapshot(), announceRemote); }
    catch (error) {
      setConnected(false);
      setStatus(error instanceof Error ? error.message : "连接失败");
    }
  }, [applySnapshot]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const poll = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(true); }, 5_000);
    const onVisibility = () => { if (document.visibilityState === "visible") void refresh(true); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => { window.clearInterval(poll); document.removeEventListener("visibilitychange", onVisibility); };
  }, [refresh]);

  const schedulePersist = useCallback((delay = SAVE_DELAY) => {
    window.clearTimeout(saveTimer.current);
    window.clearTimeout(retryTimer.current);
    saveTimer.current = window.setTimeout(() => { void persistRef.current(); }, delay);
  }, []);

  const persistDraft = useCallback(async (): Promise<boolean> => {
    if (savePromise.current) {
      const saved = await savePromise.current;
      if (!saved || pendingDraft.current === null) return saved;
      return persistRef.current();
    }

    const content = pendingDraft.current;
    if (content === null) return true;
    pendingDraft.current = null;
    if (!content.trim()) { setStatus("草稿为空，尚未保存"); return true; }

    let retryScheduled = false;
    const operation = (async () => {
      const activeId = activeIdRef.current;
      const wasForked = forkedFromHistory.current;
      setStatus("正在保存…");
      try {
        let result: { id: string };
        if (activeId) {
          try { result = await api.updateClip(activeId, content); }
          catch (error) {
            if (!(error instanceof ApiError) || error.status !== 404) throw error;
            activeIdRef.current = undefined;
            result = await api.saveClip(content);
          }
        } else {
          result = await api.saveClip(content);
        }
        activeIdRef.current = result.id;
        setSelectedId(result.id);
        forkedFromHistory.current = false;
        setEditorMode("saved");
        setConnected(true);
        setStatus(wasForked ? "已基于历史创建新记录" : "已同步");
        await refresh(false);
        return true;
      } catch (error) {
        const retryable = !(error instanceof ApiError) || error.status >= 500;
        if (retryable && pendingDraft.current === null) pendingDraft.current = content;
        setConnected(false);
        setStatus(error instanceof Error ? `尚未同步：${error.message}` : "尚未同步");
        if (retryable) {
          retryScheduled = true;
          retryTimer.current = window.setTimeout(() => { void persistRef.current(); }, RETRY_DELAY);
        }
        return false;
      }
    })();

    savePromise.current = operation;
    try { return await operation; }
    finally {
      savePromise.current = null;
      if (pendingDraft.current !== null && !retryScheduled) schedulePersist();
    }
  }, [refresh, schedulePersist]);
  persistRef.current = persistDraft;

  useEffect(() => {
    const onOnline = () => { if (pendingDraft.current !== null) void persistRef.current(); };
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.clearTimeout(saveTimer.current);
      window.clearTimeout(retryTimer.current);
      window.clearTimeout(pendingDeleteRef.current?.timer);
      window.clearTimeout(clearTimer.current);
    };
  }, []);

  const queueSave = (value: string) => {
    setText(value);
    if (editorModeRef.current === "history" || editorModeRef.current === "expired") {
      activeIdRef.current = undefined;
      setSelectedId(undefined);
      forkedFromHistory.current = true;
      setEditorMode("draft");
    } else if (editorModeRef.current === "new") {
      setEditorMode("draft");
    }
    pendingDraft.current = value;
    setStatus(value.trim() ? "正在保存…" : "草稿为空，尚未保存");
    schedulePersist();
  };

  const flushPending = async () => {
    window.clearTimeout(saveTimer.current);
    if (savePromise.current) {
      const saved = await savePromise.current;
      if (!saved) return false;
    }
    return pendingDraft.current === null ? true : persistRef.current();
  };

  const openClip = async (clip: Clip) => {
    if (!await flushPending()) return;
    setText(clip.content);
    activeIdRef.current = undefined;
    forkedFromHistory.current = false;
    setSelectedId(clip.id);
    setEditorMode("history");
    setRemoteNotice(false);
    setOpenMenu(undefined);
    setStatus("正在查看历史记录");
    textareaRef.current?.focus();
  };

  const startNew = async () => {
    if (!await flushPending()) return;
    setText("");
    activeIdRef.current = undefined;
    forkedFromHistory.current = false;
    setSelectedId(undefined);
    setEditorMode("new");
    setRemoteNotice(false);
    setStatus("新记录尚未保存");
    textareaRef.current?.focus();
  };

  const copyText = async (value: string, id?: string) => {
    await navigator.clipboard.writeText(value);
    if (id) { setCopiedClip(id); window.setTimeout(() => setCopiedClip(undefined), 1_200); }
    else { setCopied(true); window.setTimeout(() => setCopied(false), 1_200); }
  };

  const finalizeDelete = useCallback(async (pending: PendingDelete) => {
    if (pendingDeleteRef.current?.clip.id !== pending.clip.id) return;
    pendingDeleteRef.current = undefined;
    setPendingDelete(undefined);
    try { await api.deleteClip(pending.clip.id); await refresh(false); }
    catch (error) { setStatus(error instanceof Error ? `删除失败：${error.message}` : "删除失败"); await refresh(false); }
  }, [refresh]);

  const beginDelete = (clip: Clip) => {
    if (pendingDeleteRef.current) return;
    const pending = { clip, timer: 0 };
    pending.timer = window.setTimeout(() => { void finalizeDelete(pending); }, UNDO_DELAY);
    pendingDeleteRef.current = pending;
    setPendingDelete(clip);
    setOpenMenu(undefined);
    if (selectedIdRef.current === clip.id) setStatus("记录待删除，当前文本仍保留");
  };

  const undoDelete = () => {
    window.clearTimeout(pendingDeleteRef.current?.timer);
    pendingDeleteRef.current = undefined;
    setPendingDelete(undefined);
    setStatus("已撤销删除");
    void refresh(false);
  };

  const clearClips = async () => {
    if (!confirmClear) {
      setConfirmClear(true);
      clearTimer.current = window.setTimeout(() => setConfirmClear(false), UNDO_DELAY);
      return;
    }
    window.clearTimeout(clearTimer.current);
    window.clearTimeout(saveTimer.current);
    window.clearTimeout(retryTimer.current);
    window.clearTimeout(pendingDeleteRef.current?.timer);
    if (savePromise.current) await savePromise.current;
    window.clearTimeout(saveTimer.current);
    window.clearTimeout(retryTimer.current);
    pendingDeleteRef.current = undefined;
    pendingDraft.current = null;
    setPendingDelete(undefined);
    setConfirmClear(false);
    try {
      await api.clearClips();
      setData((current) => ({ ...current, clips: [] }));
      setText("");
      activeIdRef.current = undefined;
      setSelectedId(undefined);
      setEditorMode("new");
      setStatus("剪切板记录已清空");
    } catch (error) { setStatus(error instanceof Error ? `清空失败：${error.message}` : "清空失败"); }
  };

  const uploadFiles = async (files: File[]) => {
    for (const file of files) {
      setUploads((old) => ({ ...old, [file.name]: 0 }));
      try { await api.upload(file, (progress) => setUploads((old) => ({ ...old, [file.name]: progress }))); await refresh(false); }
      catch (error) { setStatus(error instanceof Error ? error.message : "上传失败"); }
      finally { setUploads((old) => { const next = { ...old }; delete next[file.name]; return next; }); }
    }
  };
  useEffect(() => {
    const paste = (event: ClipboardEvent) => { const files = [...(event.clipboardData?.files ?? [])]; if (files.length) { event.preventDefault(); void uploadFiles(files); } };
    window.addEventListener("paste", paste); return () => window.removeEventListener("paste", paste);
  });

  const visibleClips = useMemo(() => data.clips.filter((clip) => clip.id !== pendingDelete?.id), [data.clips, pendingDelete]);
  const modeLabel = editorMode === "history" ? "历史记录" : editorMode === "expired" ? "云端已过期" : editorMode === "saved" ? "当前记录" : "新记录";
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
      <p className="intro-copy">最多保留 20 条文本记录，文件私密中转，所有内容会在 24 小时后清理。</p>
    </section>

    <div className="workspace-grid">
      <section className="card clip-card" aria-labelledby="clipboard-title">
        <div className="card-title">
          <span><span className="section-icon" aria-hidden="true"><Clipboard size={18} /></span><span><b id="clipboard-title">临时剪切板</b><small>同一轮编辑自动保存为一条记录</small></span></span>
          <div className="clipboard-heading-actions"><small className={`sync-status ${isErrorStatus(status) ? "is-error" : ""}`} aria-live="polite">{status}</small><button className="button button-ghost button-compact" onClick={() => void startNew()}><Plus size={15} />新建</button></div>
        </div>

        <div className="clipboard-layout">
          <div className="editor-pane">
            <div className="editor-meta"><span className={`mode-badge is-${editorMode}`}>{modeLabel}</span><span>{text.length.toLocaleString()} 字符</span></div>
            <label className="sr-only" htmlFor="clipboard-content">剪切板内容</label>
            <textarea ref={textareaRef} id="clipboard-content" value={text} onChange={(event) => queueSave(event.target.value)} placeholder="粘贴文本、链接或代码…" spellCheck="false" />
            <div className="clip-actions">
              {confirmClear ? <button className="button button-ghost" onClick={() => setConfirmClear(false)}>取消</button> : <span>修改历史记录时会创建副本</span>}
              <button className={`button ${confirmClear ? "button-danger" : "button-ghost"}`} disabled={data.clips.length === 0 && text.length === 0} onClick={() => void clearClips()}><Trash2 size={16} />{confirmClear ? "确认清空全部" : "清空"}</button>
              <button className="button button-primary" disabled={!text} onClick={() => void copyText(text)}>{copied ? <Check size={17} /> : <Copy size={17} />}{copied ? "已复制" : "复制内容"}</button>
            </div>
          </div>

          <aside className="history-pane" aria-labelledby="history-title">
            <div className="history-heading"><span><b id="history-title">最近记录</b><small>{visibleClips.length} / 20</small></span><small>最新优先</small></div>
            {remoteNotice && data.clips[0] && <button className="remote-notice" onClick={() => void openClip(data.clips[0])}>发现新的云端记录，查看最新</button>}
            <ol className="clip-history">
              {visibleClips.length === 0 && <li className="history-empty"><Clipboard size={22} /><span><b>还没有文本记录</b><small>在左侧输入后会自动保存</small></span></li>}
              {visibleClips.map((clip) => <li key={clip.id} className={selectedId === clip.id ? "is-selected" : ""}>
                <button className="history-open" title={clip.content} onClick={() => void openClip(clip)}>
                  <span>{compactText(clip.content)}</span>
                  <small><time dateTime={clip.createdAt}>{formatClipTime(clip.createdAt)}</time><em>{remaining(clip.expiresAt)}</em></small>
                </button>
                <div className="history-actions">
                  <button aria-label={`复制记录：${compactText(clip.content).slice(0, 24)}`} title="复制" onClick={() => void copyText(clip.content, clip.id)}>{copiedClip === clip.id ? <Check size={16} /> : <Copy size={16} />}</button>
                  <button className="history-delete" disabled={Boolean(pendingDelete)} aria-label="删除这条记录" title="删除" onClick={() => beginDelete(clip)}><Trash2 size={16} /></button>
                  <button className="history-more" aria-label="更多操作" aria-expanded={openMenu === clip.id} onClick={() => setOpenMenu((current) => current === clip.id ? undefined : clip.id)}><MoreHorizontal size={17} /></button>
                  {openMenu === clip.id && <div className="history-menu" role="menu"><button role="menuitem" disabled={Boolean(pendingDelete)} onClick={() => beginDelete(clip)}><Trash2 size={15} />删除记录</button></div>}
                </div>
              </li>)}
            </ol>
          </aside>
        </div>
      </section>

      <section className="card files-card" aria-labelledby="files-title">
        <div className="card-title"><span><span className="section-icon" aria-hidden="true"><Cloud size={18} /></span><span><b id="files-title">文件中转站</b><small>支持拖放与粘贴截图</small></span></span><small className="file-count">{data.files.length} 个文件</small></div>
        <div className="files-layout">
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
                  <button aria-label={`复制 ${file.name} 的下载链接`} title="复制下载链接" onClick={async () => { await navigator.clipboard.writeText(new URL(api.downloadUrl(file.id), location.href).href); setCopiedLink(file.id); window.setTimeout(() => setCopiedLink(undefined), 1_200); }}>{copiedLink === file.id ? <Check size={17} /> : <Link size={17} />}</button>
                  <a aria-label={`下载 ${file.name}`} title="下载" href={api.downloadUrl(file.id)}><Download size={17} /></a>
                  <button aria-label={`删除 ${file.name}`} title="删除" onClick={() => api.deleteFile(file.id).then(() => refresh(false))}><X size={17} /></button>
                </div>
              </article>)}
            </div>
          </div>
        </div>
      </section>
    </div>

    {pendingDelete && <div className="undo-toast" role="status"><span>记录将在 5 秒后删除</span><button onClick={undoDelete}><RotateCcw size={15} />撤销</button></div>}
    <footer><span><ShieldCheck size={13} /> 私有访问</span><span>24 小时自动清理</span><span>文件私密存储</span></footer>
  </main>;
}
