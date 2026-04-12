# Code Review Tool for Agent-Assisted Development

## Context

Build a cross-platform (Mac + PC) desktop app for reviewing code changes made by AI agents. Inspired by Sublime Merge (commit graph, multi-select commits) and VSCode (side-by-side diffs, inline editing). Fills gaps in existing tools: merged view of commits + uncommitted changes, local comments file for feeding back to agents, remote environment connectivity, and modal comment/edit workflow.

## Architecture Overview

```
┌──────────────────────────────────────────────────────┐
│                   Tauri 2.x Window                   │
│  ┌────────────────────────────────────────────────┐  │
│  │          React + TypeScript Frontend           │  │
│  │   DAG Graph (SVG)  │  Diff (CodeMirror 6)     │  │
│  │   Commit List      │  Comment Panel            │  │
│  └─────────────┬──────────────────────────────────┘  │
│                │ Tauri IPC (invoke / events)          │
│  ┌─────────────┴──────────────────────────────────┐  │
│  │           Rust Backend (Tauri Core)            │  │
│  │   git/: local git ops via git2-rs              │  │
│  │   remote/: persistent shell subprocess         │  │
│  │   review/: session, comments, edits            │  │
│  └────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
         │                              │
    Local .git repo              User's connect command
                                 (ssh, aws ssm, gh cs, etc.)
                                 → persistent shell → git CLI
```

## Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| App shell | **Tauri 2.x** | Lightweight (~10MB), Rust backend, cross-platform |
| Backend git | **git2-rs** (libgit2) | Full programmatic git access, no shelling out |
| Frontend | **React + TypeScript** | Best ecosystem for editor/graph components |
| Diff viewer | **CodeMirror 6** + `@codemirror/merge` | Side-by-side diff, `collapseUnchanged` for expandable context, editable, lighter than Monaco |
| State mgmt | **Zustand** | Lightweight, no boilerplate, good async story |
| DAG graph | **SVG** with virtualization | DOM hit-testing, CSS hover/selection, accessible |
| IPC type safety | **specta + tauri-specta** | Auto-generate TS types from Rust structs |
| Remote | **Subprocess shell** | Spawns user's own connect command (ssh, aws ssm, etc.) — zero auth to implement |
| Styling | **Tailwind CSS** | Rapid UI development |

## Workspace Structure

```
Cargo.toml (workspace)
├── crates/
│   └── review-core/          # Shared library: git ops, types, diff engine
│       ├── src/
│       │   ├── lib.rs
│       │   ├── repo.rs       # Repository wrapper
│       │   ├── dag.rs        # DAG graph construction + lane layout
│       │   ├── diff.rs       # Diff computation (merged, single, working tree)
│       │   ├── file.rs       # File content at revision
│       │   └── types.rs      # All IPC-boundary types (Serialize/Deserialize)
│       └── Cargo.toml
├── src-tauri/                 # Tauri app backend
│   ├── src/
│   │   ├── main.rs
│   │   ├── commands/         # Tauri IPC command handlers
│   │   │   ├── git.rs        # open_repo, get_dag, get_merged_diff, get_file_at_revision
│   │   │   ├── review.rs     # create_session, add_comment, record_edit, export
│   │   │   └── remote.rs     # connect, disconnect, list_connections
│   │   ├── git/              # GitBackend trait + local implementation (git2-rs)
│   │   ├── remote/           # Remote connection via persistent shell subprocess
│   │   │   ├── connection.rs # Subprocess lifecycle (spawn, send cmd, read output)
│   │   │   ├── git_cli.rs    # RemoteGitBackend: formats git commands, parses output
│   │   │   └── profiles.rs   # Saved connection profiles
│   │   ├── review/           # Session persistence
│   │   │   ├── session.rs
│   │   │   ├── comments.rs
│   │   │   └── edits.rs
│   │   └── error.rs
│   └── Cargo.toml
├── src/                       # React frontend
│   ├── App.tsx
│   ├── api/                   # Typed wrappers around invoke()
│   │   ├── git.ts
│   │   ├── review.ts
│   │   └── remote.ts
│   ├── stores/
│   │   ├── selectionStore.ts  # Commit selection + diff state (central store)
│   │   ├── reviewStore.ts     # Comments, edits, session
│   │   ├── remoteStore.ts     # Connection state
│   │   └── uiStore.ts         # Mode (comment/edit), panel sizes, theme
│   ├── components/
│   │   ├── layout/            # AppLayout, Toolbar, StatusBar
│   │   ├── graph/             # CommitGraph (SVG), CommitList, CommitRow
│   │   ├── diff/              # DiffView, DiffEditor (CM6), FileList, InlineComment
│   │   ├── review/            # CommentPanel, CommentEditor, EditLog
│   │   └── remote/            # ConnectionDialog, ConnectionBadge
│   └── hooks/
│       ├── useKeyboardShortcuts.ts
│       └── useVirtualScroll.ts
├── package.json
└── tauri.conf.json
```

No separate `review-server` crate — remote operations use git CLI over the user's existing connection command.

## Key Design Decisions

### 1. Merged Diff Algorithm

The core feature: selecting commits A, B, C + working tree and seeing one merged diff.

- **Commits only**: `diff_tree_to_tree(parent_of_A.tree(), C.tree())` — net effect of the range
- **Commits + working tree**: `diff_tree_to_workdir_with_index(parent_of_A.tree())` — net effect from before the range to current working state
- Both use git2-rs built-in methods, no custom merge logic needed

### 2. CodeMirror 6 MergeView for Diffs

The `MergeView` takes full file contents (old + new side), diffs them internally, and renders side-by-side with change highlighting. Key features we get:

- **Expandable context**: `collapseUnchanged: { margin: 3, minSize: 4 }` — collapses unchanged regions, click to expand
- **Edit mode**: Toggle `EditorState.readOnly` via a `Compartment` — instant mode switch without recreating the editor
- **Inline comments**: `Decoration.widget({ block: true })` inserts comment widgets between diff lines
- **Comment gutter**: Custom gutter with "+" on hover to add comments, speech bubble icon on commented lines

### 3. Modal Comment/Edit Workflow

- Default mode is **comment**: clicking a gutter line opens the comment editor
- Press `Cmd+E` to toggle **edit mode**: right-side editor becomes writable
- All edits are tracked via `EditorView.updateListener`, capturing old/new text
- On exiting edit mode: edits are applied to the working tree file, recorded in the session JSON, and an `auto_edit` comment is auto-generated so the agent sees what was manually changed

### 4. Remote Architecture: Persistent Shell Subprocess

No SSH library, no remote server binary, no port forwarding. Instead, the app uses whatever command the user already has for connecting to their remote environment.

**How it works:**

1. User configures a connection profile with their connect command:
   ```json
   {
     "name": "My Dev Server",
     "connect_command": "ssh my-dev-host",
     "repo_path": "/home/user/my-project"
   }
   ```
   The `connect_command` can be anything: `ssh host`, `aws ssm start-session --target i-xxx`, `gh cs ssh -c my-codespace`, a custom wrapper script, etc.

2. On "Connect", the app spawns the command as a **persistent child process** with piped stdin/stdout.

3. Git operations are sent through the shell with output delimiters:
   ```
   → stdin:  git -C /path/to/repo log --format="%H%x00%P%x00%an%x00%at%x00%s" --all; echo "__REVIEW_DONE_$?__"
   ← stdout: abc123\0def456\0Alice\01712345\0Fix bug\n...
             __REVIEW_DONE_0__
   ```

4. The Rust backend parses the structured git output (using `--format`, `--porcelain`, `--raw` modes) into the same typed structs used locally.

**Key git CLI commands used remotely:**
- DAG data: `git log --format="%H%x00%P%x00%an%x00%at%x00%s%x00%D" --all --topo-order`
- Diffs: `git diff <base>..<head>` or `git diff <base>` (for working tree)
- File content: `git show <commit>:<path>`
- Working tree status: `git status --porcelain=v2`
- Apply edit: write via `cat > file` or `sed` (only needed in edit mode)

**`GitBackend` trait** abstracts local vs remote — frontend never knows the difference:

```rust
#[async_trait]
pub trait GitBackend: Send + Sync {
    async fn get_dag(&self, opts: DagOptions) -> Result<DagGraph>;
    async fn get_merged_diff(&self, range: CommitRange) -> Result<MergedDiff>;
    async fn get_file_at_revision(&self, path: &str, rev: &str) -> Result<String>;
    // ...
}

struct LocalGitBackend { repo: git2::Repository }       // uses git2-rs directly
struct RemoteGitBackend { shell: ChildProcess, repo_path: String }  // pipes git CLI commands
```

**Why this works well:**
- Zero deployment — nothing to install on the remote, just needs `git`
- Handles AWS SSO, custom ProxyCommands, SSM, etc. — the user pre-auths, then the cached token just works
- One persistent connection — pay the connection cost once, then commands are fast
- No custom protocol to maintain

### 5. DAG Graph Layout

Lane assignment algorithm (straight-branch variant):
- Walk commits topologically (newest first) via `git2::Revwalk`
- Maintain active lanes `Vec<Option<Oid>>`
- Assign each commit to a lane; free lanes on merge
- Output: `(lane, row)` per commit + edges with color indices
- Frontend renders as SVG circles + cubic Bezier curves, virtualized with `@tanstack/react-virtual`

## Comments File Format

Stored at `.ai-review/sessions/{session_id}.json` in the repo. The `.ai-review/` directory is gitignored.

```json
{
  "version": "1.0",
  "session": {
    "id": "uuid",
    "repo": "/path/to/repo",
    "branch": "feature/thing",
    "base_commit": "abc123",
    "head_commit": "def456 or WORKING_TREE",
    "reviewed_commits": ["oldest", "...", "newest"],
    "created_at": "ISO8601",
    "updated_at": "ISO8601"
  },
  "comments": [
    {
      "id": "uuid",
      "type": "comment | suggestion | issue | auto_edit",
      "file": "src/main.rs",
      "line_range": { "side": "old | new", "start": 42, "end": 45 },
      "body": "Markdown text",
      "severity": "info | warning | error | suggestion",
      "resolved": false,
      "created_at": "ISO8601",
      "context": {
        "before": "3 lines before",
        "content": "the commented lines",
        "after": "3 lines after"
      }
    }
  ],
  "edits": [
    {
      "id": "uuid",
      "file": "src/main.rs",
      "line_range": { "start": 12, "end": 12 },
      "old_content": "original text",
      "new_content": "edited text",
      "description": "What was changed and why",
      "applied_at": "ISO8601",
      "associated_comment_id": "uuid or null"
    }
  ],
  "summary": "Optional overall review summary"
}
```

Design choices for agent consumption:
- **`context` on every comment** — agent doesn't need to re-read files
- **`auto_edit` type** — manual tweaks appear in the same comments list so the agent sees all feedback in one place
- **`severity`** — agent can prioritize errors over suggestions
- **`old_content`/`new_content` in edits** — strong signal about intent and style

## UI Layout

```
┌──────────────────────────────────────────────────────────────┐
│  Toolbar  [Branch v]  [Connection: local]  [Mode: Comment]   │
├──────────────┬───────────────────────────────┬───────────────┤
│  Commit      │       Diff Viewer             │   Comment     │
│  Graph +     │   (CodeMirror 6 MergeView)    │   Panel       │
│  List        │                               │               │
│  ○─ abc123   │  ┌─ old ────┐  ┌─ new ────┐  │  ┌─────────┐  │
│  │  Fix bug  │  │          │  │          │  │  │ Comment │  │
│  ○─ def456   │  │  - old   │  │  + new   │  │  │ Thread  │  │
│  │  Add feat │  │          │  │          │  │  │         │  │
│  ●─ ghi789   │  └──────────┘  └──────────┘  │  └─────────┘  │
│  │  [HEAD]   │                               │               │
│  ●  <working>│                               │               │
│              │                               │               │
├──────────────┤                               │               │
│  File List   │                               │               │
│  src/main.rs │                               │               │
└──────────────┴───────────────────────────────┴───────────────┘
```

Three resizable panels. Left panel splits vertically: commit graph (top) + changed file list (bottom).

## Phased Build Plan

### Phase 1: Local Core (first)
- Tauri 2.x + React + TypeScript scaffolding
- `review-core` crate: repo open, commit listing, `diff_tree_to_tree` for single + range diffs, `diff_tree_to_workdir_with_index` for working tree
- Flat commit list (no DAG yet — just scrollable list with branch labels)
- CodeMirror 6 MergeView: side-by-side diff, syntax highlighting, expandable context
- Multi-select commits + working tree toggle → merged diff display
- File list panel, three-panel resizable layout
- **Validate CM6 MergeView integration early — it's the riskiest frontend piece**

### Phase 2: Comments + Edit Mode
- Comment mode: click gutter to add comment, inline widgets in diff
- Comment panel (right sidebar), grouped by file
- Review session persistence to `.ai-review/sessions/*.json`
- Edit mode toggle (`Cmd+E`), edit tracking, apply to working tree
- Auto-generated `auto_edit` comments for manual tweaks
- Session export + "Copy Claude command" button
- Keyboard shortcuts

### Phase 3: DAG Graph
- Lane assignment algorithm in Rust
- SVG rendering: circles, Bezier curves, branch colors
- Integrated with virtualized commit list (`@tanstack/react-virtual`)
- Branch/tag labels, working tree pseudo-node
- Click + shift-click range selection on graph nodes

### Phase 4: Remote Connections
- `RemoteGitBackend`: spawn user's connect command as persistent subprocess
- Pipe git CLI commands over stdin, parse structured output (--format, --porcelain)
- `GitBackend` trait: swap local ↔ remote transparently
- Connection profiles UI (name, connect command, repo path)
- Connection status indicator, auto-reconnect on disconnect
- No binary deployment, no SSH library — just subprocess + git CLI

## Verification

- **Phase 1**: Open a real repo, select 2-3 commits + working tree, verify merged diff shows correct net changes. Expand collapsed context in diff. Switch between files.
- **Phase 2**: Leave comments on diff lines, verify they persist across app restart. Toggle edit mode, make a change, verify it's written to disk and recorded in session JSON. Export session and verify JSON is valid and contains context snippets.
- **Phase 3**: Open a repo with multiple branches, verify DAG renders correctly with lane assignment. Multi-select via graph nodes.
- **Phase 4**: SSH into a remote machine, open a repo, verify all operations work identically to local.
