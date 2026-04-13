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

## Remaining: Phase 4 — Remote Connections

The app currently only works with local git repos. Phase 4 adds the ability to
connect to remote environments and review code there.

### Architecture
Spawn the user's own connect command (ssh, aws ssm, gh cs ssh, etc.) as a
persistent child process with piped stdin/stdout. Send git CLI commands through
the shell and parse structured output. No SSH library, no remote binary, no
port forwarding.

### Tasks
- [ ] `GitBackend` trait in Rust abstracting local (git2-rs) vs remote (git CLI)
- [ ] `RemoteGitBackend`: spawn user's connect command as persistent subprocess
- [ ] Command framing: send git commands with delimiters, parse structured output
  - DAG: `git log --format="%H%x00%P%x00%an%x00%at%x00%s%x00%D" --topo-order`
  - Diffs: `git diff <base>..<head>` or `git diff <base>` (working tree)
  - File content: `git show <commit>:<path>`
  - Status: `git status --porcelain=v2`
- [ ] Connection profiles UI (name, connect command, repo path)
- [ ] Connection profiles persistence (save/load)
- [ ] Connection status indicator in toolbar
- [ ] Auto-reconnect on disconnect
- [ ] Apply edits remotely via `cat > file` in edit mode
- [ ] Frontend: connection dialog, connection badge, swap local↔remote transparently

### Design Constraints
- Zero deployment — nothing to install on the remote, just needs `git`
- Works with any auth (SSH keys, AWS SSO, SSM, ProxyCommand, etc.)
- One persistent connection — pay the connection cost once
- No custom protocol to maintain

## Known Limitations / Future Improvements
- No virtualized scrolling for commit list (fine at 50 commits, would need it for more)
- No inline comment widgets in the diff itself (comments only in the panel)
- No `specta`/`tauri-specta` for auto-generated TS types (types are manually mirrored)
- Comment `context` fields (before/content/after) are not populated yet
- Tag display removed for performance (could be re-added with lazy loading)
