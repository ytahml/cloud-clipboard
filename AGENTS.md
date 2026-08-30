# Cloud Clipboard agent entrypoint

Before analyzing, changing, testing, reviewing, or deploying this repository:

1. Read `.codex/skills/cloud-clipboard-project/SKILL.md` completely and follow its task routing. Load only the reference selected by that routing.
2. Read `.codex/memories/PROJECT_MEMORY.md` for prior decisions, preferences, failures, and verification history. Treat it as historical context.
3. Use current source, configuration, migrations, canonical documentation, and `README.md` as product truth when they conflict with history.

## Working boundaries

- Preserve unrelated user changes and keep every write within the requested scope.
- Before a destructive or bulk cleanup, list the exact targets, retained items, and verification plan, then obtain explicit confirmation. Prefer recoverable operations.
- Keep credentials, secrets, test payloads, and local deployment state out of commits, logs, and chat.
