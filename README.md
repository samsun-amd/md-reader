# MD Reader

A local dark-mode Markdown file reader with a file-tree sidebar. Browse and read all `.md` / `.mdx` files under any folder on your machine through a clean web UI.

![Layout](https://img.shields.io/badge/layout-sidebar%20%2B%20viewer-blue) ![Theme](https://img.shields.io/badge/theme-dark-black)

---

## What you get

- **Left sidebar**: collapsible folder tree of your docs (resizable by dragging the divider)
- **Right panel**: rendered Markdown with
  - Syntax highlighting for code blocks
  - LaTeX math (`$...$` and `$$...$$`)
  - Mermaid diagrams (```` ```mermaid ````)
  - GitHub-flavored Markdown (tables, task lists, strikethrough)
- **Dark mode** UI
- **Hot config**: edit `config.json` and refresh the browser — no server restart needed

---

## Prerequisites

You need **Node.js 18 or newer** and **npm**. Check with:

```bash
node --version    # should print v18.x.x or higher
npm  --version
```

If you don't have Node.js:
- **Ubuntu / Debian / WSL**: `sudo apt update && sudo apt install -y nodejs npm`
- **macOS**: `brew install node`
- **Other**: download from <https://nodejs.org/>

---

## First-time setup (3 steps)

### 1. Get the code

```bash
git clone <this-repo-url> md-reader
cd md-reader
```

(If you already have the folder, just `cd` into it.)

### 2. Tell it where your Markdown files live

Open `config.json` and change the `path` to the folder you want to browse. Both formats work:

```json
{
  "roots": [
    { "name": "My Docs", "path": "~/md" }
  ],
  "port": 3001,
  "clientPort": 5174
}
```

- `~/md` is expanded to your home directory automatically (e.g. `/home/you/md`)
- You can also use an absolute path: `/home/you/projects/notes`
- You can list **multiple roots** — each one shows up as a top-level entry in the sidebar:

  ```json
  "roots": [
    { "name": "Work Notes",     "path": "~/work/docs" },
    { "name": "Personal Wiki",  "path": "~/wiki" }
  ]
  ```

- `port` is the backend API port (default `3001`).
- `clientPort` is the web UI port you open in your browser (default `5174`). Change either if the port is already in use.

### 3. Install dependencies

This installs both backend and frontend packages (takes ~1 minute):

```bash
npm run install:all
```

---

## Running the app

### Start

```bash
./start.sh
```

You should see:

```
Starting server...
  → PID 12345  log: logs/server.log
Starting client (Vite)...
  → PID 12346  log: logs/client.log

MD Reader started.
  Server : http://localhost:3001
  Client : http://localhost:5174
```

Open <http://localhost:5174> in your browser (or whatever `clientPort` you set in `config.json`).

### Stop

```bash
./stop.sh
```

### Check status / logs

```bash
tail -f logs/server.log    # backend log
tail -f logs/client.log    # Vite dev server log
```

The PIDs of running processes are stored in `run/server.pid` and `run/client.pid`.

---

## Using it

1. The left sidebar shows your folder tree. Click any folder to expand/collapse it.
2. Click any `.md` file to render it on the right.
3. Drag the vertical divider between sidebar and content to resize.
4. Click the **↺** button at the top of the sidebar to re-scan the folder (after adding new files).
5. To switch to a different folder, edit `config.json` and refresh the browser tab — no restart needed.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `./start.sh: Permission denied` | `chmod +x start.sh stop.sh` |
| Browser shows "Loading…" forever | Check `logs/server.log` — usually means the path in `config.json` doesn't exist |
| `EADDRINUSE` in logs | The configured `port` (backend) or `clientPort` (UI) is already in use. Change them in `config.json` or kill the conflicting process (`ss -tlnp \| grep :PORT`). |
| Sidebar is empty | The configured root has no `.md` / `.mdx` files (other file types are hidden by design) |
| Changes to `config.json` not showing | Refresh the browser (Ctrl+R / Cmd+R). The file is re-read on every request. |
| Want to stop everything cleanly | `./stop.sh` — it kills both the server and Vite |

---

## How it works (for the curious)

```
md-reader/
├── config.json         # which folders to expose
├── start.sh / stop.sh  # background process management
├── server/             # Express API on port 3001
│   ├── index.js
│   └── routes/
│       ├── files.js    # GET /api/files   → folder tree JSON
│       └── content.js  # GET /api/content → raw markdown
└── client/             # Vite + React on port 5173
    └── src/
        ├── App.jsx
        └── components/
            ├── Sidebar.jsx
            ├── FileTree.jsx
            └── MarkdownViewer.jsx
```

The Vite dev server proxies `/api/*` to the Express backend, so you only need to open one URL (`localhost:5173`).

**Security**: the backend refuses any file path that isn't under one of your configured roots, so the web UI can't reach files elsewhere on disk.
