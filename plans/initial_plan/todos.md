# ReadCode — Project Status

## Completed

### Phase 1: Local Core
- [x] Tauri 2.x + React + TypeScript scaffolding
- [x] `review-core` crate: repo open, commit listing, merged diffs, working tree diffs
- [x] CodeMirror 6 MergeView: side-by-side diff, syntax highlighting (10 languages), expandable collapsed context
- [x] Multi-select commits (Ctrl/Cmd+click, Shift+click) + working tree toggle
- [x] File list with multi-select, select all/none
- [x] Three-panel resizable layout (allotment), toggleable sidebar and review panel
- [x] Recent repos persisted to localStorage with dropdown menu
- [x] Reload button, loading spinner
- [x] Collapsible file sections in diff viewer
- [x] Performance: async Tauri commands, skip remote branches, local-only branch map
- [x] Untracked files shown in working tree diff
- [x] Clear stale commits immediately when switching repos

### Phase 2: Comments + Edit Mode
- [x] Review session persistence to `.ai-review/sessions/*.json` (auto-gitignored)
- [x] Comment mode: click "+" gutter to add comments (type, severity, line range)
- [x] Comment panel (right sidebar) grouped by file, with resolve/delete
- [x] Blue dot gutter markers on lines with existing comments
- [x] Click comment in panel scrolls to file in diff viewer (auto-opens file if needed)
- [x] Multi-line range comments (select lines, then click gutter)
- [x] Edit mode toggle (Cmd+E): right side becomes editable, writes to working tree on exit
- [x] Auto-generated `auto_edit` comments for manual edits
- [x] "Copy for AI" export button (copies session JSON to clipboard)
- [x] End session with confirmation (renames file to `{id}-ended.json`)
- [x] Resume unfinished sessions when opening a repo
- [x] Auto-pause review when changing commit selection
- [x] Session summary editor
- [x] Session file path shown in panel (click to copy)

### Phase 3: DAG Graph
- [x] Lane assignment algorithm in Rust (straight-branch variant)
- [x] SVG rendering: circles, cubic Bezier curves, 10 branch colors
- [x] Pass-through lines for active lanes across intermediate rows
- [x] Local branch labels on commits
- [x] Working tree pseudo-node aligned with HEAD's lane
- [x] Right-click context menu: copy short hash, full hash, branch name
- [ ] Virtualized scrolling with `@tanstack/react-virtual` (not needed at 50 commits)

### Phase 4: Remote Connections

One-shot `ssh -T host "git -C /path ..."` commands for each git operation.
SSH ControlMaster multiplexing caches the connection so only the first
command pays the handshake cost. Batched commands (`run_git_batch`) combine
multiple git operations into a single SSH invocation to reduce round-trips.

#### Done
- [x] `BackendState` enum in Rust dispatching local (git2-rs) vs remote (git CLI)
- [x] `RemoteRepo` with one-shot SSH transport: `run_ssh`, `run_git`,
      `run_git_batch` for batching multiple commands per SSH invocation
- [x] SSH ControlMaster multiplexing (`ControlPersist=3600`,
      `ServerAliveInterval=60`) for connection reuse
- [x] Parallel file content fetches (`tokio::join!` for old + new revisions)
- [x] `RemoteRepo`: list_commits, get_merged_diff (numstat + name-status
      batched), get_file_at_revision, get_file_diff_content, get_commit_message
- [x] Shared `review_core::dag::assemble_commits` used by both backends
- [x] Connection profiles persistence (`connection_profiles.json` in app data)
- [x] Tauri commands: `open_remote_repo`, `disconnect_remote`,
      `list_profiles`, `save_profile`, `delete_profile`
- [x] Frontend: `api/remote.ts`, `ConnectionDialog`, toolbar "Connect to
      Remote..." entry, REMOTE badge in toolbar, connectionMode in
      selectionStore
- [x] Review sessions stored in app data dir (keyed by repo hash) —
      works for both local and remote repos
- [x] Unified recent repos list: remote repos appear alongside local
      repos in the dropdown with SSH badge
- [x] Right-click commit → "Show commit message" modal with full text
- [x] Working tree refresh button (re-fetches diff without reloading commits)
- [x] Reload button works for remote repos (refreshes commits only)

#### Follow-ups
- [ ] Auto-reconnect on disconnect
- [ ] Apply edits remotely via SSH in edit mode (`write_file_to_workdir`
      currently errors for remote)
- [ ] Remote untracked files (local shows them via libgit2, `git diff` does not)
- [ ] Paths with tabs/newlines in diff parsing (drop tab-split, use `-z`)
- [ ] Connection health check + visual "disconnected" state
- [ ] Binary-safe file content (currently `String::from_utf8_lossy`)

### Design Constraints
- Zero deployment — nothing to install on the remote, just needs `git`
- Works with any auth (SSH keys, AWS SSO, SSM, ProxyCommand, etc.)
- ControlMaster reuses connections — pay the SSH handshake cost once
- No custom protocol to maintain

## Known Limitations / Future Improvements
- No virtualized scrolling for commit list (fine at 50 commits, would need it for more)
- No inline comment widgets in the diff itself (comments only in the panel)
- No `specta`/`tauri-spectra` for auto-generated TS types (types are manually mirrored)
- Comment `context` fields (before/content/after) are not populated yet
- Tag display removed for performance (could be re-added with lazy loading)
