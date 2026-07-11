export interface Clip { id: string; content: string; createdAt: string; expiresAt: string }
export interface SharedFile { id: string; name: string; size: number; type: string; createdAt: string; expiresAt: string }
export interface Snapshot { clips: Clip[]; files: SharedFile[]; viewer?: string; storage: string }
