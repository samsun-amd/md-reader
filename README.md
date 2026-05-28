# MD Reader

A local dark-mode Markdown reader/editor with a file-tree sidebar, a collapsible table-of-contents, and a CodeMirror editor with live preview. Browse, read, edit, upload, rename and delete `.md` / `.mdx` files under any folders on your machine through a clean web UI.

![Layout](https://img.shields.io/badge/layout-sidebar%20%2B%20viewer%20%2B%20toc-blue) ![Theme](https://img.shields.io/badge/theme-dark-black)

---

## What you get

- **Three-column layout**: file tree on the left, viewer in the middle, table-of-contents on the right — both side panels are resizable and collapsible.
- **Rendered Markdown** with:
  - Syntax highlighting for code blocks
  - LaTeX math (`$...$` and `$$...$$`)
  - Mermaid diagrams (```` ```mermaid ````)
  - GitHub-flavored Markdown (tables, task lists, strikethrough)
- **Editor mode** powered by CodeMirror:
  - **Read / Split / Edit** toggle
  - Undo / Redo (Ctrl+Z, Ctrl+Y / Ctrl+Shift+Z)
  - Save with the button or **Ctrl+S** (Cmd+S on macOS)
  - Unsaved-change indicator (yellow dot), confirm-on-discard when switching files
- **Table of contents** (right panel):
  - Auto-built from headings, nested by level
  - Per-section collapse, plus collapse the whole panel
  - Click to jump (smooth scroll, updates URL hash)
  - **Scrollspy**: current section highlighted as you scroll
- **File management** directly from the sidebar:
  - ⋯ menu on every row: **New file** (folders), **Rename**, **Delete** (files)
  - **Drag & drop** one or many `.md` / `.mdx` files from your OS file manager onto any folder to upload them (auto-renames on conflict)
- **Run as a service** via systemd user units (optional, see below).
- **Dark mode** UI throughout.

---

## Prerequisites

You need **Node.js 18 or newer** and **npm**.

```bash
node --version    # v18+
npm  --version
```

- **Ubuntu / Debian / WSL**: `sudo apt update && sudo apt install -y nodejs npm`
- **macOS**: `brew install node`
- **Other**: <https://nodejs.org/>

---

## First-time setup

```bash
git clone <this-repo-url> md-reader
cd md-reader

# Create your local config from the template
cp config.example.json config.json
# Edit config.json to point at the folder(s) you want to browse

# Install backend + frontend dependencies (~1 min)
npm run install:all
```

### Configuring `config.json`

```json
{
  "roots": [
    { "name": "Work Notes",    "path": "~/work/docs" },
    { "name": "Personal Wiki", "path": "~/wiki" }
  ],
  "port": 3001,
  "clientPort": 5174
}
```

- `~` is expanded to your home directory.
- Absolute paths work too: `/mnt/c/Users/you/notes`.
- Each entry under `roots` shows up as a top-level node in the sidebar.
- `port` = backend API port, `clientPort` = the URL you open in your browser.

> `config.json` is **gitignored** — it stays local and never gets committed.

---

## Running the app

### Foreground / quick start

```bash
./start.sh        # runs server + Vite in the background, logs to ./logs
./stop.sh         # stops both
tail -f logs/server.log
```

Open <http://localhost:5174> (or whatever `clientPort` is set to).

### Run as a system service (auto-start on boot)

```bash
./systemd/install.sh       # installs ~/.config/systemd/user/md-reader-{server,client}.service
                           # then enables + starts both

# To survive reboot without an interactive login:
sudo loginctl enable-linger "$USER"

# Day-to-day: start.sh / stop.sh will automatically use systemctl when units exist.
systemctl --user status   md-reader-server md-reader-client
systemctl --user restart  md-reader-server md-reader-client
journalctl --user -u md-reader-server -f

# Remove the services later:
./systemd/uninstall.sh
```

On **WSL2**, systemd is off by default. Add to `/etc/wsl.conf`:

```ini
[boot]
systemd=true
```

then run `wsl --shutdown` from Windows and reopen the shell. `systemctl is-system-running` should report `running` or `degraded`.

---

## Using it

### Reading
- Click a file in the left tree to render it in the middle.
- The right TOC panel jumps you to any heading; the section under your cursor is highlighted as you scroll.
- Drag the dividers between panels to resize. Click **✕** on the TOC header to collapse it (☰ re-expands it).

### Editing
- Use the **Read / Split / Edit** toggle at the top right of the viewer.
- In **Split** mode, edit on the left and watch the rendered output update live on the right.
- **Save** with the button or **Ctrl+S** / **Cmd+S**. A yellow dot (●) appears next to the filename while there are unsaved changes.
- Switching files with unsaved changes asks you to confirm.

### File management
- **⋯ menu** on each tree row:
  - Folders → **New file…** (auto-appends `.md` if you don't, opens immediately in the editor).
  - Files → **Rename…** or **Delete** (asks for confirmation).
- **Drag & drop** files from Windows Explorer / Finder onto any folder row to upload them. Multiple files at once work. Same-named files are auto-renamed to `name (2).md`, `name (3).md`, … — nothing is ever overwritten.
- Hit **↺** in the sidebar header to manually re-scan the disk.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `./start.sh: Permission denied` | `chmod +x start.sh stop.sh systemd/*.sh` |
| Browser shows "Loading…" forever | Check `logs/server.log` — usually the path in `config.json` doesn't exist |
| `EADDRINUSE` in logs | Change `port` / `clientPort` in `config.json`, or kill the conflicting process (`ss -tlnp \| grep :PORT`) |
| Sidebar is empty | Configured root has no `.md` / `.mdx` files (other types are hidden by design) |
| Changes to `config.json` not showing | Refresh the browser tab (Ctrl+R). Config is re-read on every API request. |
| New file / rename / upload all return errors | The backend wasn't restarted after pulling new code. `./stop.sh && ./start.sh`. |
| systemd unit fails on WSL | Confirm `/etc/wsl.conf` has `[boot]\nsystemd=true` and that you ran `wsl --shutdown` |

---

## Architecture

```
md-reader/
├── config.example.json         # template (config.json is local & gitignored)
├── start.sh / stop.sh          # detect systemd units and delegate, else nohup
├── systemd/
│   ├── md-reader-server.service.template
│   ├── md-reader-client.service.template
│   ├── install.sh              # renders templates → ~/.config/systemd/user
│   └── uninstall.sh
├── server/                     # Express API (port 3001 by default)
│   ├── index.js
│   ├── lib/paths.js            # loadConfig, isUnderRoot, uniqueName
│   └── routes/
│       ├── files.js            # GET tree; POST /new, /rename; DELETE
│       ├── content.js          # GET / PUT markdown body
│       └── upload.js           # POST multipart upload (multer)
└── client/                     # Vite + React (port 5174 by default)
    └── src/
        ├── App.jsx             # 3-column resizable layout
        └── components/
            ├── Sidebar.jsx     # drives all mutations + toasts
            ├── FileTree.jsx    # rows, ⋯ menu, drag-drop targets
            ├── MarkdownViewer.jsx   # Read/Split/Edit + CodeMirror + save
            └── TocPanel.jsx    # nested collapsible TOC + scrollspy
```

Vite proxies `/api/*` to Express, so you only ever open one URL.

### API

| Method | Path | Body / Query | Purpose |
|---|---|---|---|
| GET    | `/api/files` | — | Folder tree across all roots |
| POST   | `/api/files/new` | `{ folder, name }` | Create empty `.md` (auto-rename on conflict) |
| POST   | `/api/files/rename` | `{ path, newName }` | Rename a file (409 on name clash) |
| DELETE | `/api/files`  | `?path=...` | Delete one `.md`/`.mdx` (files only) |
| GET    | `/api/content` | `?path=...` | Read raw markdown |
| PUT    | `/api/content` | `{ path, content }` | Save edited markdown |
| POST   | `/api/upload`  | multipart: `folder`, `files[]` | Upload one or many `.md`/`.mdx` |

### Security model

The backend rejects any path that doesn't resolve under one of the configured `roots`, blocks path traversal via `path.basename` + `path.resolve`, and only operates on `.md` / `.mdx` files. There is no auth — this is meant to run locally on your own machine.
