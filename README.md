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
  - **↻ Refresh** re-reads the open file from disk, so changes made elsewhere show up
  - Unsaved-change indicator (yellow dot), confirm-on-discard when switching files
- **Table of contents** (right panel):
  - Auto-built from headings, nested by level
  - Per-section collapse, plus collapse the whole panel
  - Click to jump (smooth scroll, updates URL hash)
  - **Scrollspy**: current section highlighted as you scroll
- **File management** directly from the sidebar:
  - ⋯ menu on every row: **New file** / **Pin folder** (folders), **Rename**, **Delete** (files)
  - **Drag & drop** one or many `.md` / `.mdx` files from your OS file manager onto any folder to upload them (auto-renames on conflict)
- **Pinned folders**: keep the folders you live in at the top of the sidebar, per
  machine, so a deeply nested directory is one click away — see [Pinned folders](#pinned-folders).
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
  "allowRemoteAccess": false,
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
- `allowRemoteAccess` (default `false`) controls whether other machines can reach
  the service — see [Allowing remote access](#allowing-remote-access).
- `readOnly` (default `false`) — see [Read-only mode](#read-only-mode).
- Roots are grouped into **Local** / **Remote** tabs in the sidebar automatically —
  you keep one flat `roots` array, the UI does the grouping.

> You don't have to hand-edit this file to manage roots — the **⚙ button** in the
> sidebar opens a form-based editor. See [Managing roots from the UI](#managing-roots-from-the-ui).

> **Back-compat:** a bare `{ "name": "...", "path": "..." }` (no `id`/`type`) still
> works and is treated as local — but new configs should use the explicit form above.

> `config.json` is **gitignored** — it stays local and never gets committed.

> The server caches config on startup. After editing `config.json`, click **↺** in the sidebar header to reload it — no restart needed. (Reload also drops cached remote SSH connections, so edits to remote roots take effect too.) Changing `allowRemoteAccess` or the ports requires a restart, since those bind sockets at startup.

> **Build gotcha:** the client's `vite.config.js` reads `config.json` at build
> time (to learn the ports for the dev proxy). A `config.json` **must exist**
> before you build or run the client, or the build fails. Copy the example first.

---

## Managing roots from the UI

Instead of hand-editing `config.json`, click the **⚙** button in the sidebar
header to open a form-based root manager — no JSON required. From there you can:

- **Add** a local folder or a remote machine (separate **+ Add local** / **+ Add
  remote** buttons).
- **Edit** any existing root.
- **Delete** a root (this only removes it from the sidebar; **no files are
  deleted** on disk or on the remote).

The root's `id` is derived from the **Name** you type and is immutable afterwards
(it is what `config.json` and saved paths key on), so there is nothing extra to
invent. Pinned folders are not shown in this form and are preserved across an
edit — change a machine's password and its pins stay put.

Each change is written straight to `config.json` (atomically), the server reloads
its config, and the sidebar refreshes — no restart needed. The editor is hidden
in [read-only mode](#read-only-mode).

### Passwords are write-only

Remote SSH passwords are handled so the plaintext is **never sent back to the
browser**:

- The UI only ever knows *whether* a password is set (shown as `●●●●`), not what
  it is.
- When **editing** a remote root, the password field starts **blank**:
  - **Leave it blank** → the existing password is kept unchanged.
  - **Type a new value** → the password is replaced.
  - **Tick "Clear saved password"** → the stored password is removed.

The password is only used server-side to open the SFTP session, exactly as if you
had typed it into `config.json` by hand.

> The `allowRemoteAccess` flag and the ports are **not** editable here — they bind
> sockets at startup, so changing them requires editing `config.json` and
> restarting (see [Allowing remote access](#allowing-remote-access)).

---

## Remote roots (read/write over SSH/SFTP)

A remote root is **a machine you can SSH to**. The sidebar shows that machine's
`.md` tree starting at its home directory, and you read/write its files directly
over SFTP — no manual `scp`. Local and remote roots can be mixed freely in the
same `config.json`.

```json
{
  "roots": [
    { "id": "docs", "name": "My Docs", "type": "local",  "path": "~/md" },
    { "id": "servant", "name": "Servant", "type": "remote",
      "host": "10.0.0.5", "port": 22,
      "user": "root", "password": "changeme", "os": "posix",
      "pins": ["notes", "projects/wiki"] }
  ],
  "port": 3001,
  "clientPort": 5174
}
```

### What a remote root is

A remote root carries its own SSH connection details (`host`/`user`/…) and
nothing else — **one entry per machine**. It always opens at the remote home
directory; to jump straight to a folder you use often, [pin it](#pinned-folders)
rather than adding a second entry. Only `type:"remote"` roots ever touch the SSH
library, so a purely local setup never needs it. Connection details are
**self-contained in `config.json`** — no external inventory file is consulted.

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Stable, **unique** identifier for the root (see "token model"). Derived from `name` when you add a machine through the ⚙ editor. |
| `name` | yes | Label shown on the machine's sub-tab. |
| `type` | yes (`"remote"`) | Selects the SFTP backend. |
| `host` | yes | Hostname or IP of the remote machine. |
| `user` | yes | SSH username. |
| `password` | no | SSH password. (Key-based auth is not supported.) |
| `port` | no (default `22`) | SSH port. |
| `os` | no (default `posix`) | `"posix"` or `"windows"`. Windows remotes work too — SFTP is OS-agnostic. |
| `pins` | no | Pinned folders, **relative to the root**, e.g. `["notes", "projects/wiki"]`. Usually managed from the UI. |

> **Upgrading:** `remotePath` and `machineName` are no longer supported. A root
> always opens at `~` and the sub-tab is labelled with `name`. Both keys are
> ignored with a startup warning; if you relied on `remotePath` to open a
> subfolder, pin that folder instead.

> ⚠️ Remote credentials live in `config.json`, which is **gitignored** — never
> commit a `config.json` containing real passwords. The password is used only
> server-side to open the SFTP session and is never sent to the browser.

---

## Allowing remote access

By default the service is **localhost-only**: the API binds `127.0.0.1`, the Vite
client binds `localhost`, and CORS rejects non-local origins. This is the right
setting for production, where the app should not be reachable from other machines.

For testing from **another computer**, set `allowRemoteAccess: true` in
`config.json`:

```json
{ "roots": [ /* … */ ], "allowRemoteAccess": true, "port": 3001, "clientPort": 5174 }
```

When enabled:

- the API server binds `0.0.0.0` (reachable on every interface),
- the Vite client binds `0.0.0.0`, and
- CORS accepts **all** origins.

Then open `http://<this-machine-ip>:<clientPort>` from the other computer.

> ⚠️ This applies **no authentication** — anyone who can reach the host/port can
> read and write your configured roots. Only enable it on a **trusted private
> network or VPN**, and set it back to `false` for production. Changing this flag
> requires a **restart** (it binds sockets at startup; the **↺** reload won't pick
> it up).

## Read-only mode

Set `readOnly: true` in `config.json` to serve documents without allowing edits.
Every `POST` / `PUT` / `PATCH` / `DELETE` under `/api` is rejected with **403**
before it reaches a route, so a direct API caller can't write either — not just
the UI. The editor collapses to a **Read-only** badge and the ⚙ root manager is
hidden.

Two endpoints are exempt because neither can alter a document:

- `POST /api/config/reload` — re-reads `config.json` from disk.
- `POST` / `DELETE /api/config/roots/:id/pins` — [pinning](#pinned-folders) is
  navigation, i.e. a bookmark for a folder you can already browse.

> ⚠️ Combined with `allowRemoteAccess: true` (no auth), the pin exemption means
> anyone who can reach the port can change the pin list. They still cannot read
> or write anything outside your configured roots. Restart required after
> changing `readOnly`.

### Sidebar: Local / Remote tabs

`config.json` stays a single flat `roots` array — the sidebar groups it for you:

- A **Local** and a **Remote** tab split roots by `type`.
- Under **Remote**, one **sub-tab per machine**, labelled with the root's `name`
  (hover to see the host), so you always know whose file system you're looking at.

To reach a second folder on a machine you do **not** add a second root — pin it.

### Pinned folders

Each root can pin folders you open often. They appear in a block above the tree,
so a folder ten levels down is one click away instead of ten.

- Pin or unpin from the **⋯** menu on any folder row.
- Pins are **per machine** and show only while that machine's sub-tab is active.
- They start **collapsed**; the block grows with the number of pins and caps at
  half the sidebar, scrolling internally beyond that.
- They are stored in `config.json` as paths relative to the root (`"pins":
  ["notes", "projects/wiki"]`), so they survive a browser change and can be
  hand-edited.
- A pin is a second way into the tree you already loaded — expanding one costs no
  extra request. If the folder disappears on the machine, the row is struck
  through with an **Unpin** button rather than vanishing silently.

Pinning is exempt from [read-only mode](#read-only-mode): it is navigation, not a
document edit.

### Each root loads independently

The sidebar fetches `GET /api/files/roots` (metadata only, no SSH) to build the
tabs instantly, then loads each root's tree on its own via
`GET /api/files/root/:id`:

- **Local roots load while the Local tab is visible.** Directory reads are
  asynchronous, so slow local folders do not block SSH responses or other roots.
  A slow or offline remote only affects its own sub-tab, which shows an inline
  error with a **Retry** button.
- **Remote sub-tabs load lazily** — a machine is only contacted when you first
  open its sub-tab. **↺** reloads `config.json` and refreshes only the visible roots.
  Responses from older tree requests cannot overwrite a newer refresh.

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
`~`-relative path becomes a dangling link. Instead, `link-core` installs core's
build dependencies (including devDependencies), **rebuilds `dist/` on every run**,
creates `node_modules/@ssh-manager/core` as a symlink anchored on a shell-expanded
path, and verifies that core can be loaded. An existing `dist/` is not proof that
it matches the source. Install or build failures stop the script before linking.

This builds the source already in your ssh-manager checkout; it does not run
`git pull` or restart services. Remote roots continue to use connection details
from md-reader's own `config.json`, via core's `adhocEndpoint()` API. They do not
read `ssh_remote_*.json`, so sshm config groups require no md-reader migration.

> **Re-link after every `npm install`.** A plain `npm install` prunes the
> symlink (it's "extraneous"), so remote roots break until you re-run
> `npm run link-core`. See [Maintenance](#re-link-ssh-managercore-after-any-npm-install-remote-only).

> An offline or misconfigured remote root shows an **inline error in the
> sidebar** (and the API returns **HTTP 503**) instead of hanging the whole
> tree — other roots still load.

**On the remote machine:** install **ripgrep** (`rg`) for fast tree listing — one
command instead of thousands of SFTP round-trips, the difference between sub-second
and minutes on a large home. It's optional (POSIX remotes fall back to `find` when
`rg` is missing; Windows remotes use an SFTP walk) but strongly recommended.
Install with `apt install ripgrep` / `dnf install ripgrep` / `brew install ripgrep`.
You only need SSH access to the
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
- **↻** (viewer header) re-reads the current file from disk — use it after the file
  changed elsewhere, e.g. a `git pull` or an edit on the remote machine.

### Editing
- Use the **Read / Split / Edit** toggle at the top right of the viewer.
- In **Split** mode, edit on the left and watch the rendered output update live on the right.
- **Save** with the button or **Ctrl+S** / **Cmd+S**. A yellow dot (●) appears next to the filename while there are unsaved changes.
- Switching files with unsaved changes asks you to confirm.

### File management
- **⋯ menu** on each tree row:
  - Folders → **New file…** (auto-appends `.md` if you don't, opens immediately in the editor) and **Pin folder** / **Unpin folder**.
  - Files → **Rename…** or **Delete** (asks for confirmation).
- **Drag & drop** files from Windows Explorer / Finder onto any folder row to upload them. Multiple files at once work. Same-named files are auto-renamed to `name (2).md`, `name (3).md`, … — nothing is ever overwritten.
- Hit **↺** in the sidebar header to **reload `config.json`** on the server (picks up edited roots without a restart) and re-scan the disk. Port changes require a restart.

---

## Maintenance & operations

Day-to-day upkeep once it's deployed.

### Local QA

```bash
npm test                      # baseline regression tests; no core installation needed
npm run test:core              # remote installs: test against the linked, built core
npm --prefix client run build # check the frontend build after install:all
```

Both test suites run locally without an SSH server, reachable target, real
credentials, or access to your configured roots. They use Node's built-in test
runner; no additional test framework is required.

- `npm test` covers local file CRUD and uploads, filename conflicts, path/token
  boundaries, POSIX and Windows remote tree responses, simulated remote errors,
  pool reset, password/pin preservation, and config persistence/reload. It also
  checks that slow local directory reads yield to other work, stale tree
  responses cannot replace newer results, and remote refresh loads only visible
  roots. Sidebar checks execute the request handler and loading effect without
  a browser; they do not exercise DOM rendering. The
  `link-core.sh` checks run Bash and npm against dependency-free temporary
  packages with npm offline mode enabled, covering stale builds, custom paths,
  re-linking, and failure handling. Your real core build and links are untouched.
- `npm run test:core` requires `npm run link-core` first. It uses the actual core
  `adhocEndpoint`, `SshPool`, `RemoteFs`, and error class, replacing the session
  boundary with a local SFTP adapter over temporary files. It checks backend/core
  compatibility, file operations, tree tokens, and errors, and fails if md-reader
  tries to load an sshm inventory. It does not test SSH authentication or network
  reachability; use the app against a configured remote for that.

Tests create and remove temporary fixtures without reading or writing your real
`config.json`. The frontend build requires installed client dependencies and an
existing `config.json` (use `config.example.json` for a fresh checkout).

### Updating to new code

```bash
git pull --ff-only
npm run install:all           # if dependency manifests or lockfiles changed
# Remote installs only: update your ssh-manager checkout when needed, then:
# git -C ../ssh-manager pull --ff-only
npm run link-core             # remote only: rebuild core, re-link, verify load
npm test
npm run test:core             # remote only: verify the actual core/backend contract
npm --prefix client run build
# Then restart whichever way you run it:
systemctl --user restart md-reader-server md-reader-client   # if using systemd
# or
./stop.sh && ./start.sh                                      # if running loose
```

The backend caches loaded code, so **a restart is required** after updating it or
rebuilding core. The sidebar's **↺** reloads config and clears SSH connections; it
does **not** reload JavaScript modules. Only the Vite client hot-reloads its code.
Run the checks successfully before restarting. Local-only installs skip both
`link-core` and `test:core`.

### Re-link `@ssh-manager/core` after any `npm install` (remote only)

`@ssh-manager/core` is a **symlink** in `node_modules`, not a normal dependency. A
plain `npm install` treats it as extraneous and **prunes it**, which breaks remote
roots with `Cannot find module '@ssh-manager/core'`. After any install, re-link:

```bash
npm run link-core
```

This also rebuilds core; `npm run install:remote` runs `install:all` followed by
this same build/link step. Ordinary `start.sh` and the ssh-manager CLI installer
do not rebuild core.

### Rebuild core after editing the ssh-manager source (remote only)

md-reader loads core's **compiled** output (`packages/core/dist/`, set by core's
`package.json` `main`), **not** the TypeScript source. So if you change
`ssh-manager/packages/core/src/**`, you must rebuild its `dist/` or md-reader keeps
running the old code:

```bash
# From md-reader, after editing/updating the linked ssh-manager checkout:
npm run link-core
npm run test:core
# Restart so the server reloads the compiled code:
systemctl --user restart md-reader-server   # or ./stop.sh && ./start.sh
```

If webscp links to the same core directory, this rebuild updates its shared
files too; already-loaded modules remain cached until that process restarts.
File-backed consumers of the current core must use `{ "group_number": 0,
"nodes": [...] }` (or another valid group), rather than a legacy array. Convert
external legacy inventories before updating those consumers. md-reader's inline
connection settings and core's in-memory `new Inventory(nodes)` API are unchanged.

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

Edit roots in `config.json`, then click **↺** in the sidebar. The server re-reads
the roots and drops cached remote SSH connections without a restart. Changes to
`port`, `clientPort`, `allowRemoteAccess`, or `readOnly` require a restart because
the sockets and middleware are initialized at startup.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `./start.sh: Permission denied` | `chmod +x start.sh stop.sh systemd/*.sh` |
| Browser shows "Loading…" forever | Check `logs/server.log` — usually the path in `config.json` doesn't exist |
| `EADDRINUSE` in logs | Change `port` / `clientPort` in `config.json`, or kill the conflicting process (`ss -tlnp \| grep :PORT`) |
| Sidebar is empty | Configured root has no `.md` / `.mdx` files (other types are hidden by design) |
| Changes to `config.json` not showing | Click **↺** in the sidebar header to reload roots. Ports and startup settings require a restart. If **↺** still does nothing, the running service may be serving a different repo/clone — check its working dir: `ls -l /proc/$(systemctl --user show -p MainPID --value md-reader-server)/cwd`, then re-run `./systemd/install.sh` from the correct repo and restart. |
| New file / rename / upload all return errors | The backend wasn't restarted after pulling new code. `./stop.sh && ./start.sh`. |
| API calls fail only from another site/tab | By default CORS allows the local client only (`localhost` / `127.0.0.1`). Open the app at its configured `clientPort`, or set `allowRemoteAccess: true` (and restart) to allow other machines — see [Allowing remote access](#allowing-remote-access). |
| systemd unit fails on WSL | Confirm `/etc/wsl.conf` has `[boot]\nsystemd=true` and that you ran `wsl --shutdown` |
| Remote root shows an inline error / red row | Read the error before changing credentials: connection, command, and filesystem failures can all appear here. The API returns 503 for connectivity, 400 for a bad/incomplete remote root. Check `host`/`user`/`password` for connection or authentication failures; see below for timeouts. |
| Remote reload times out while another SSH session still works | See [Remote refresh timeouts](#remote-refresh-timeouts). MD Reader uses its own SSH pool, and an exec timeout does not prove the SSH transport disconnected. |
| A pinned folder is struck through | That folder no longer exists on the machine (renamed or deleted). Click **Unpin** on the row, then pin the new location. |
| `Cannot find module '@ssh-manager/core'` | The symlink was pruned (usually by a recent `npm install`) or never created. Run `npm run link-core`. Only `type:"remote"` roots hit this. |
| Edited ssh-manager core source but nothing changed | Run `npm run link-core` and `npm run test:core` from md-reader, then restart the server. The sidebar reload does not reload core code. See [Maintenance](#rebuild-core-after-editing-the-ssh-manager-source-remote-only). |
| Pulled new code but behavior is unchanged | The backend caches code at startup — restart it (`systemctl --user restart md-reader-server` or `./stop.sh && ./start.sh`). |
| A whole remote machine's sub-tab errors, others fine | Only that root's request failed. Diagnose its inline error, then hit **Retry** or **↺**; other roots load independently. |
| Client build fails reading `config.json` | `cp config.example.json config.json` first — Vite reads it at build time. |

### Remote refresh timeouts

**Reload config & refresh** closes MD Reader's cached SSH pool, reloads root
metadata, and fetches the visible trees. A separate SSH terminal uses a different
connection, so it can remain healthy while MD Reader's connection or command
fails. The linked core currently uses 15-second handshake and exec timeouts;
these are not a deadline for the whole HTTP request.

Local tree walks use `fs.promises.readdir()` so slow Windows, OneDrive, or network
directory reads do not block the Node.js event loop. Remote refresh does not
start local scans. Each tree load has a request identity: clearing trees or
starting a newer load invalidates the old response, including a late timeout.
Older versions used synchronous local scans and accepted stale responses, which
could produce a timeout even with a healthy SSH transport or replace a successful
refresh with an older error. After updating, restart the backend to load the fix.

If a timeout recurs, capture the exact inline error and the failed request's
status, response body, and duration in the browser's Network panel. Distinguish
`POST /api/config/reload`, `GET /api/files/roots`, and
`GET /api/files/root/:id`. For a tree request, measure connection acquisition,
SFTP home resolution, and the remote `rg`/`find` command separately, and check for
backend event-loop stalls before increasing a timeout. The API currently returns
route errors in the response rather than logging each failed request.

---

## Architecture

```
md-reader/
├── config.example.json         # template (config.json is local & gitignored)
├── start.sh / stop.sh          # detect systemd units and delegate, else nohup
├── scripts/
│   └── link-core.sh            # rebuild, link and load-check @ssh-manager/core
├── test/
│   ├── backend.test.js         # local operations and simulated remote behavior
│   ├── config.test.js          # settings, passwords, pins and isolated persistence
│   ├── link-core.test.js       # offline build/link regression fixtures
│   ├── sidebar.test.js         # stale responses and visible-root loading
│   └── core/compat.test.js     # actual core + backend, with a local SFTP adapter
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
| GET    | `/api/files/roots` | — | Root metadata only (id, name, type, host, pins) — no SSH, builds the tabs instantly |
| GET    | `/api/files/root/:id` | — | Folder tree for **one** root (503 if that remote is unreachable; other roots unaffected) |
| POST   | `/api/files/new` | `{ folder, name }` | Create empty `.md` (auto-rename on conflict) |
| POST   | `/api/files/rename` | `{ path, newName }` | Rename a file (409 on name clash) |
| DELETE | `/api/files`  | `?path=...` | Delete one `.md`/`.mdx` (files only) |
| GET    | `/api/content` | `?path=...` | Read raw markdown |
| PUT    | `/api/content` | `{ path, content }` | Save edited markdown |
| POST   | `/api/upload`  | multipart: `folder`, `files[]` | Upload one or many `.md`/`.mdx` |
| POST   | `/api/config/reload` | — | Re-read `config.json` + drop cached remote connections |
| GET    | `/api/config/settings` | — | Runtime flags the client needs at startup (currently `readOnly`) |
| GET    | `/api/config/roots` | — | Roots for the ⚙ editor (passwords replaced by `hasPassword`) |
| POST   | `/api/config/roots` | one root | Add a root |
| PUT    | `/api/config/roots/:id` | one root | Edit a root (`id` immutable; omitted `password` and `pins` are kept) |
| DELETE | `/api/config/roots/:id` | — | Remove a root (no files deleted) |
| POST   | `/api/config/roots/:id/pins` | `{ rel }` | Pin a folder, path relative to the root |
| DELETE | `/api/config/roots/:id/pins` | `{ rel }` | Unpin a folder |

### Security model

The backend never trusts a client token. For every operation it decodes the
token, looks up the owning root, and re-validates the decoded path against **that
specific root's** boundary:

- **Local roots:** paths are canonicalized with `realpath` and confirmed under
  the root, so traversal (`..`), absolute paths, and **symlinks pointing outside
  a root are blocked** (a symlinked parent can't be used to escape).
- **Remote roots:** the decoded remote path is normalized (collapsing `..`) and
  must stay under the remote home, blocking `..` escape over SFTP.
- **Pins** are stored as relative paths and rejected if they are absolute or
  contain `.` / `..` segments. Pinning never contacts the remote (so it works
  while a machine is offline), and every actual read is still boundary-checked
  independently.
- A token whose `type` doesn't match its root, or whose root id is unknown, is
  rejected (400 / 404) — it can't fall through to another backend.
- Names for uploaded/created/renamed files are reduced to a basename, stripping
  any directory components.
- Only reads/writes/deletes `.md` / `.mdx` files.
- By default restricts **CORS to the local client** (`localhost` / `127.0.0.1` / `[::1]`, plus non-browser tools that send no `Origin`), so a random website you visit can't drive the file API through your browser. Setting `allowRemoteAccess: true` relaxes this to all origins for trusted-network testing — see [Allowing remote access](#allowing-remote-access).

There is no auth — by default this runs locally on your own machine. Remote SSH
credentials are stored in `config.json` (gitignored) and used only server-side to
open the SFTP session; they are never sent to the browser.
