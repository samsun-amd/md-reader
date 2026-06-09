# MD Reader

A dark-mode Markdown reader/editor with a file-tree sidebar, a collapsible table-of-contents, and a CodeMirror editor with live preview. Browse, read, edit, upload, rename and delete `.md` / `.mdx` files through a clean web UI — from folders on your own machine **and** from folders on remote machines over SSH/SFTP.

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

> The server caches config on startup. After editing `config.json`, click **↺** in the sidebar header to reload it — no restart needed. (Reload also drops cached remote SSH connections, so edits to `~/note/ssh_remote.json` or remote roots take effect too.)

> **Build gotcha:** the client's `vite.config.js` reads `config.json` at build
> time (to learn the ports for the dev proxy). A `config.json` **must exist**
> before you build or run the client, or the build fails. Copy the example first.

---

## Remote roots (read/write over SSH/SFTP)

A root can point at a folder on **another machine**. The sidebar then shows that
machine's `.md` tree and you read/write its files directly over SFTP — no manual
`scp`. Local and remote roots can be mixed freely in the same `config.json`.

```json
{
  "roots": [
    { "id": "docs", "name": "My Docs", "type": "local",  "path": "~/md" },
    { "id": "srv",  "name": "Servant", "type": "remote", "node": "client", "remotePath": "~/notes" }
  ],
  "port": 3001,
  "clientPort": 5174
}
```

### What a remote root is

A remote root names a machine (`node`) plus a folder on it (`remotePath`). The
server connects over SFTP and lists/reads/writes that folder's `.md`/`.mdx`
files exactly like a local root. Only `type:"remote"` roots ever touch the SSH
library, so a purely local setup never needs it.

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Stable, **unique** identifier for the root (see "token model"). |
| `type` | yes (`"remote"`) | Selects the SFTP backend. |
| `node` | yes | Entry in `~/note/ssh_remote.json` — by **name**, **number**, or **IP**. The same inventory `sshm` uses; credentials live there, not in `config.json`. Server sub-targets work too (e.g. a host behind a BMC) via the core selectors. |
| `remotePath` | no (default `~`) | Folder on that machine. `~` expands to the **remote** home, not yours. |

- Windows remotes work too — SFTP is OS-agnostic, no special handling.
- The inventory file path can be overridden with `SSH_REMOTE_JSON`; otherwise it
  defaults to `~/note/ssh_remote.json`.

### The token model (how a path knows which machine it lives on)

Internally every file's `path` is an **opaque token** that encodes its owning
root, not a bare filesystem path:

```
local:<id>::<absolutePath>          e.g. local:docs::/home/me/md/a.md
remote:<id>::<remotePosixPath>      e.g. remote:srv::/home/me/notes/a.md
```

The client treats the token as an opaque string (it only displays/passes it).
The server parses it to pick the right backend (local `fs` vs. SFTP) and the
right machine. **This is why `id` must be unique** — it is the routing key. The
server always re-validates the decoded path against that root's boundary, so a
hand-crafted token can't escape its configured folder.

### Enabling remote support

Remote roots need the shared **[`@ssh-manager/core`](../ssh-manager)** library
linked into `node_modules`. Local-only installs can skip this entirely — core is
loaded lazily and only a `type:"remote"` root triggers the `require`.

```bash
# ssh-manager must sit beside md-reader (siblings), or set SSH_MANAGER_CORE.
npm run install:remote      # = install:all + link-core
#   or, if deps are already installed:
npm run link-core
#   non-adjacent ssh-manager checkout:
SSH_MANAGER_CORE=$HOME/path/to/ssh-manager/packages/core npm run link-core
```

**Why a symlink and not a `package.json` dependency?** npm rewrites any `file:`
dependency to a normalized form and does **not** expand `~`/`$HOME`, so a
`~`-relative path becomes a dangling link. Instead, `link-core` builds core if
needed (`dist/`) and creates `node_modules/@ssh-manager/core` as a symlink
anchored on a shell-expanded path.

> **Re-link after every `npm install`.** A plain `npm install` prunes the
> symlink (it's "extraneous"), so remote roots break until you re-run
> `npm run link-core`.

> An offline or misconfigured remote root shows an **inline error in the
> sidebar** (and the API returns **HTTP 503**) instead of hanging the whole
> tree — other roots still load.

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
- Hit **↺** in the sidebar header to **reload `config.json`** on the server (picks up edited roots/ports without a restart) and re-scan the disk.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `./start.sh: Permission denied` | `chmod +x start.sh stop.sh systemd/*.sh` |
| Browser shows "Loading…" forever | Check `logs/server.log` — usually the path in `config.json` doesn't exist |
| `EADDRINUSE` in logs | Change `port` / `clientPort` in `config.json`, or kill the conflicting process (`ss -tlnp \| grep :PORT`) |
| Sidebar is empty | Configured root has no `.md` / `.mdx` files (other types are hidden by design) |
| Changes to `config.json` not showing | Click **↺** in the sidebar header to reload config (it's cached server-side). New `roots` / ports apply without a restart. |
| New file / rename / upload all return errors | The backend wasn't restarted after pulling new code. `./stop.sh && ./start.sh`. |
| API calls fail only from another site/tab | CORS allows the local client only (`localhost` / `127.0.0.1`). Open the app at its configured `clientPort`. |
| systemd unit fails on WSL | Confirm `/etc/wsl.conf` has `[boot]\nsystemd=true` and that you ran `wsl --shutdown` |
| Remote root shows an inline error / red row | The remote is offline, the `node` name isn't in `~/note/ssh_remote.json`, or credentials/`remotePath` are wrong. The API returns 503 for connectivity, 400 for a bad inventory entry. Fix and click **↺**. |
| `Cannot find module '@ssh-manager/core'` | The symlink was pruned (usually by a recent `npm install`) or never created. Run `npm run link-core`. Only `type:"remote"` roots hit this. |
| Client build fails reading `config.json` | `cp config.example.json config.json` first — Vite reads it at build time. |

---

## Architecture

```
md-reader/
├── config.example.json         # template (config.json is local & gitignored)
├── start.sh / stop.sh          # detect systemd units and delegate, else nohup
├── scripts/
│   └── link-core.sh            # symlink @ssh-manager/core for remote roots
├── systemd/
│   ├── md-reader-server.service.template
│   ├── md-reader-client.service.template
│   ├── install.sh              # renders templates → ~/.config/systemd/user
│   └── uninstall.sh
├── server/                     # Express API (port 3001 by default)
│   ├── index.js                # app wiring + localhost-only CORS
│   ├── lib/
│   │   ├── paths.js            # config load/normalize, token codec (encode/parse/resolveToken),
│   │   │                       #   local boundary (isUnderSpecificRoot, symlink-safe), fs error → status
│   │   └── backend.js          # backend abstraction: LocalBackend (fs) + SftpBackend
│   │                           #   (@ssh-manager/core, lazy-required); backendFor() picks one per root
│   └── routes/
│       ├── files.js            # GET tree (per-root, error node on failure); POST /new, /rename; DELETE
│       ├── content.js          # GET / PUT markdown body
│       ├── upload.js           # POST multipart upload (multer)
│       └── config.js           # POST /reload — re-read config.json + drop remote connections
└── client/                     # Vite + React (port 5174 by default)
    └── src/
        ├── App.jsx             # 3-column resizable layout + unsaved-change guard
        └── components/
            ├── Sidebar.jsx     # drives all mutations + toasts + config reload
            ├── FileTree.jsx    # rows, ⋯ menu, drag-drop targets
            ├── MarkdownViewer.jsx   # Read/Split/Edit + live preview + save
            ├── Editor.jsx      # CodeMirror, lazy-loaded (Read mode skips it)
            └── TocPanel.jsx    # nested collapsible TOC + scrollspy
```

Vite proxies `/api/*` to Express, so you only ever open one URL.

**Request flow.** Every `path`/`folder` in an API call is an opaque **token**
(see [the token model](#the-token-model-how-a-path-knows-which-machine-it-lives-on)).
A route decodes it with `resolveToken()` → `{ root, innerPath }`, picks a backend
with `backendFor(root)` (LocalBackend for `fs`, SftpBackend for SFTP), and calls
a uniform method (`readFile`, `writeFile`, `listTree`, …). Each backend
re-validates `innerPath` against its own root's boundary before touching disk.

### API

`path` / `folder` values are tokens, not raw filesystem paths. Errors return a
JSON `{ error }` with a meaningful status: **400** bad/malformed token or input,
**403** path outside its root or permission denied, **404** unknown root id or
missing file, **409** name clash, **503** remote unreachable.

| Method | Path | Body / Query | Purpose |
|---|---|---|---|
| GET    | `/api/files` | — | Folder tree across all roots (a failing remote root becomes an error node, others still load) |
| POST   | `/api/files/new` | `{ folder, name }` | Create empty `.md` (auto-rename on conflict) |
| POST   | `/api/files/rename` | `{ path, newName }` | Rename a file (409 on name clash) |
| DELETE | `/api/files`  | `?path=...` | Delete one `.md`/`.mdx` (files only) |
| GET    | `/api/content` | `?path=...` | Read raw markdown |
| PUT    | `/api/content` | `{ path, content }` | Save edited markdown |
| POST   | `/api/upload`  | multipart: `folder`, `files[]` | Upload one or many `.md`/`.mdx` |
| POST   | `/api/config/reload` | — | Re-read `config.json` + drop cached remote connections |

### Security model

The backend never trusts a client token. For every operation it decodes the
token, looks up the owning root, and re-validates the decoded path against **that
specific root's** boundary:

- **Local roots:** paths are canonicalized with `realpath` and confirmed under
  the root, so traversal (`..`), absolute paths, and **symlinks pointing outside
  a root are blocked** (a symlinked parent can't be used to escape).
- **Remote roots:** the decoded remote path is normalized (collapsing `..`) and
  must stay under the root's `remotePath`, blocking `..` escape over SFTP.
- A token whose `type` doesn't match its root, or whose root id is unknown, is
  rejected (400 / 404) — it can't fall through to another backend.
- Names for uploaded/created/renamed files are reduced to a basename, stripping
  any directory components.
- Only reads/writes/deletes `.md` / `.mdx` files.
- Restricts **CORS to the local client** (`localhost` / `127.0.0.1` / `[::1]`, plus non-browser tools that send no `Origin`), so a random website you visit can't drive the file API through your browser.

There is no auth — this is meant to run locally on your own machine. Remote SSH
credentials are **never** stored here; they come from `~/note/ssh_remote.json`.
