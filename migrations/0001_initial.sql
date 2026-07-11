CREATE TABLE IF NOT EXISTS clips (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_clips_created_at ON clips(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_clips_expires_at ON clips(expires_at);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  object_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  size INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'ready')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_files_created_at ON files(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_files_expires_at ON files(expires_at);
