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

**Deploy from scratch (local folders only) — 4 steps:**

```bash
# 1. Clone
git clone <this-repo-url> md-reader
cd md-reader

# 2. Create your config from the template, then edit it to point at your folders
cp config.example.json config.json
$EDITOR config.json          # set the roots[].path values (see below)

# 3. Install backend + frontend dependencies (~1 min)
npm run install:all

# 4. Run it
./start.sh                   # starts server + client in the background
```

Then open <http://localhost:5174> (or whatever `clientPort` you set).

- Browsing **remote** machines over SSH too? Do [one extra install step](#enabling-remote-support)
  (`npm run install:remote`) and add `type:"remote"` roots.
- Want it to **auto-start on boot**? See [Run as a system service](#run-as-a-system-service-auto-start-on-boot).

The rest of this section explains each piece in detail.

### Configuring `config.json`

```json
{
  "roots": [
    { "id": "work", "name": "Work Notes",    "type": "local", "path": "~/work/docs" },
    { "id": "wiki", "name": "Personal Wiki", "type": "local", "path": "~/wiki" }
  ],
  "port": 3001,
  "clientPort": 5174
}
```

Each entry under `roots` is one folder shown in the sidebar. Fields for a **local**
root:

| Field | Required | Meaning |
|---|---|---|
| `id` | recommended | Stable, **unique** id for the root (the path "routing key"). If omitted it's auto-derived from `name`, but set it explicitly so links stay stable. |
| `name` | yes | Label shown in the sidebar. |
| `type` | no (default `local`) | `"local"` reads from this machine's disk. Use `"remote"` for SSH (see [Remote roots](#remote-roots-readwrite-over-sshsftp)). |
| `path` | yes (local) | Folder to browse. `~` expands to your home; absolute paths work too (`/mnt/c/Users/you/notes`). |

- `port` = backend API port; `clientPort` = the URL you open in your browser.
- Roots are grouped into **Local** / **Remote** tabs in the sidebar automatically —
  you keep one flat `roots` array, the UI does the grouping.

> **Back-compat:** a bare `{ "name": "...", "path": "..." }` (no `id`/`type`) still
> works and is treated as local — but new configs should use the explicit form above.

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
server lists that folder's `.md`/`.mdx` files and reads/writes them over SFTP,
exactly like a local root. Only `type:"remote"` roots ever touch the SSH
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

### Sidebar: Local / Remote tabs

`config.json` stays a single flat `roots` array — the sidebar groups it for you:

- A **Local** and a **Remote** tab split roots by `type`.
- Under **Remote**, one **sub-tab per machine** (`node`). Several roots that share
  a `node` (e.g. `~/notes` and `~/docs` on the same box) appear together under that
  machine's sub-tab, so you always know whose file system you're looking at.

So to add another folder on an existing machine, just add another `type:"remote"`
root with the same `node` and a different `id`/`remotePath` — no nesting needed.

### Each root loads independently

The sidebar fetches `GET /api/files/roots` (metadata only, no SSH) to build the
tabs instantly, then loads each root's tree on its own via
`GET /api/files/root/:id`:

- **Local roots load eagerly and never wait on a remote.** A slow or offline
  machine can no longer freeze the whole tree — it only affects its own sub-tab,
  which shows an inline error with a **Retry** button.
- **Remote sub-tabs load lazily** — a machine is only contacted when you first
  open its sub-tab. **↺** reloads `config.json` and refreshes only the visible root.

### How a remote tree is listed (fast)

Listing a remote root runs **one** command over SSH instead of walking the tree
directory-by-directory over SFTP (which is one network round-trip per directory —
minutes on a home with tens of thousands of folders):

- Primary: `rg --files -g '*.md' -g '*.mdx'` — ripgrep returns every match in one
  shot (sub-second even on large trees) and, by default, skips hidden files and
  honors `.gitignore`. Hidden files are intentionally never shown.
- Fallback: if `rg` isn't on the remote (`exit 127`), it falls back to `find`.
- The flat path list is reassembled into the nested folder tree server-side.
- **Windows remotes** have no POSIX shell for this, so they keep using the
  per-directory SFTP walk. (All-Linux setups always get the fast path.)

Reads, writes, renames, deletes and uploads still go over SFTP — only **listing**
uses the command path.

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
> `npm run link-core`. See [Maintenance](#re-link-ssh-managercore-after-any-npm-install-remote-only).

> An offline or misconfigured remote root shows an **inline error in the
> sidebar** (and the API returns **HTTP 503**) instead of hanging the whole
> tree — other roots still load.

**On the remote machine:** install **ripgrep** (`rg`) for fast tree listing — one
command instead of thousands of SFTP round-trips, the difference between sub-second
and minutes on a large home. It's optional (md-reader falls back to `find`, then to
an SFTP walk) but strongly recommended. Install with `apt install ripgrep` /
`dnf install ripgrep` / `brew install ripgrep`. You only need SSH access to the
remote — nothing from this repo is installed there.

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

This installs two **systemd user services** (`md-reader-server`, `md-reader-client`)
so the app starts automatically and restarts on failure.

```bash
# From the repo directory you want to run from:
./systemd/install.sh       # renders + installs the unit files, enables + starts both

# To survive reboot without an interactive login (recommended on WSL/headless):
sudo loginctl enable-linger "$USER"
```

Day-to-day commands:

```bash
systemctl --user status   md-reader-server md-reader-client
systemctl --user restart  md-reader-server md-reader-client
systemctl --user stop     md-reader-server md-reader-client
journalctl --user -u md-reader-server -f      # live backend logs
journalctl --user -u md-reader-client -f      # live frontend logs

./systemd/uninstall.sh     # remove the services
```

> Once the units exist, `./start.sh` / `./stop.sh` automatically delegate to
> `systemctl` instead of launching loose background processes.

#### How the service path is set (important)

systemd **cannot** use `~` or relative paths — `WorkingDirectory` and `ExecStart`
must be absolute. So you never hand-edit a path; the installer fills it in:

1. `systemd/*.service.template` contains a `__APP_DIR__` placeholder.
2. `install.sh` computes the **absolute path of the repo it is run from** and
   `sed`-substitutes it in, writing the result to
   `~/.config/systemd/user/md-reader-{server,client}.service`.
3. That absolute path is now **frozen** into the installed unit.

This means **the service is bound to whichever directory you ran `install.sh` from.**
Consequences a maintainer must know:

- **Moving or switching to a different clone of the repo?** Re-run
  `./systemd/install.sh` *from the new location*, then
  `systemctl --user restart md-reader-server md-reader-client`. A bare
  `enable --now` will **not** replace already-running processes — you must restart.
- **Editing `config.json` / pulling new code but nothing changes?** A stale unit
  may be serving an old copy. Check exactly which directory the live service runs in:
  ```bash
  ls -l /proc/$(systemctl --user show -p MainPID --value md-reader-server)/cwd
  ```
  If that path isn't the repo you're editing, re-run `install.sh` from the right one.
- To inspect the frozen paths directly:
  ```bash
  systemctl --user cat md-reader-server   # shows WorkingDirectory / ExecStart
  ```

#### WSL2 note

On **WSL2**, systemd is off by default. Add to `/etc/wsl.conf`:

```ini
[boot]
systemd=true
```

then run `wsl --shutdown` from Windows and reopen the shell.
`systemctl is-system-running` should report `running` or `degraded`.

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

## Maintenance & operations

Day-to-day upkeep once it's deployed.

### Updating to new code

```bash
git pull
npm run install:all           # only if package.json changed
npm run link-core             # ONLY if you use remote roots — see note below
# Then restart whichever way you run it:
systemctl --user restart md-reader-server md-reader-client   # if using systemd
# or
./stop.sh && ./start.sh                                      # if running loose
```

The backend caches code at process start, so **a restart is required** after
pulling — editing files alone does nothing until the server restarts. (Only the
Vite client hot-reloads on its own.)

### Re-link `@ssh-manager/core` after any `npm install` (remote only)

`@ssh-manager/core` is a **symlink** in `node_modules`, not a normal dependency. A
plain `npm install` treats it as extraneous and **prunes it**, which breaks remote
roots with `Cannot find module '@ssh-manager/core'`. After any install, re-link:

```bash
npm run link-core
```

### Rebuild core after editing the ssh-manager source (remote only)

md-reader loads core's **compiled** output (`packages/core/dist/`, set by core's
`package.json` `main`), **not** the TypeScript source. So if you change
`ssh-manager/packages/core/src/**`, you must rebuild its `dist/` or md-reader keeps
running the old code:

```bash
# in the ssh-manager checkout:
npm --prefix packages/core run build      # regenerate dist/
# back in md-reader, restart so the server reloads it:
systemctl --user restart md-reader-server   # or ./stop.sh && ./start.sh
```

`npm run link-core` also builds `dist/` if it's missing, but it won't rebuild an
**out-of-date** one — after editing core source, build explicitly.

### Confirm which repo the live service is using

If behavior doesn't match the code you're editing, verify the running process's
working directory (a stale systemd unit can point at an old clone):

```bash
ls -l /proc/$(systemctl --user show -p MainPID --value md-reader-server)/cwd
```

If it's wrong, re-run `./systemd/install.sh` from the correct repo and restart
(see [How the service path is set](#how-the-service-path-is-set-important)).

### Logs

```bash
tail -f logs/server.log logs/client.log              # loose mode (./start.sh)
journalctl --user -u md-reader-server -f             # systemd mode
journalctl --user -u md-reader-client -f
```

### Changing folders / ports

Edit `config.json`, then click **↺** in the sidebar — roots and ports apply without
a restart (the server re-reads config and drops cached remote SSH connections). No
redeploy needed for config-only changes.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `./start.sh: Permission denied` | `chmod +x start.sh stop.sh systemd/*.sh` |
| Browser shows "Loading…" forever | Check `logs/server.log` — usually the path in `config.json` doesn't exist |
| `EADDRINUSE` in logs | Change `port` / `clientPort` in `config.json`, or kill the conflicting process (`ss -tlnp \| grep :PORT`) |
| Sidebar is empty | Configured root has no `.md` / `.mdx` files (other types are hidden by design) |
| Changes to `config.json` not showing | Click **↺** in the sidebar header to reload config (it's cached server-side). New `roots` / ports apply without a restart. If **↺** still does nothing, the running service is serving a different repo/clone — check its working dir: `ls -l /proc/$(systemctl --user show -p MainPID --value md-reader-server)/cwd`, then re-run `./systemd/install.sh` from the correct repo and restart. |
| New file / rename / upload all return errors | The backend wasn't restarted after pulling new code. `./stop.sh && ./start.sh`. |
| API calls fail only from another site/tab | CORS allows the local client only (`localhost` / `127.0.0.1`). Open the app at its configured `clientPort`. |
| systemd unit fails on WSL | Confirm `/etc/wsl.conf` has `[boot]\nsystemd=true` and that you ran `wsl --shutdown` |
| Remote root shows an inline error / red row | The remote is offline, the `node` name isn't in `~/note/ssh_remote.json`, or credentials/`remotePath` are wrong. The API returns 503 for connectivity, 400 for a bad inventory entry. Fix and click **↺**. |
| `Cannot find module '@ssh-manager/core'` | The symlink was pruned (usually by a recent `npm install`) or never created. Run `npm run link-core`. Only `type:"remote"` roots hit this. |
| Edited ssh-manager core source but nothing changed | md-reader runs core's compiled `dist/`, not its `src/`. Rebuild: `npm --prefix packages/core run build` in the ssh-manager checkout, then restart the server. See [Maintenance](#rebuild-core-after-editing-the-ssh-manager-source-remote-only). |
| Pulled new code but behavior is unchanged | The backend caches code at startup — restart it (`systemctl --user restart md-reader-server` or `./stop.sh && ./start.sh`). |
| A whole remote machine's sub-tab errors, others fine | Expected isolation — only that `node` failed (offline / bad inventory entry / wrong `remotePath`). Fix and hit **Retry** or **↺**; local + other remotes are unaffected. |
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
│       ├── files.js            # GET /roots (metadata), GET /root/:id (one tree); POST /new, /rename; DELETE
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
| GET    | `/api/files/roots` | — | Root metadata only (id, name, type, node) — no SSH, builds the tabs instantly |
| GET    | `/api/files/root/:id` | — | Folder tree for **one** root (503 if that remote is unreachable; other roots unaffected) |
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
