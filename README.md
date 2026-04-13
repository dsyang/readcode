# ReadCode

A desktop app for reviewing code changes made by AI agents. Built with Tauri 2.x, React, TypeScript, and Rust.

Inspired by Sublime Merge (commit graph, multi-select commits) and VSCode (side-by-side diffs, inline editing).

## Features

- **DAG commit graph** with SVG lane rendering and branch labels
- **Merged diffs** across multiple commits + working tree
- **CodeMirror 6 MergeView** with side-by-side diff, syntax highlighting, expandable context
- **Review sessions** with comments, severity levels, and line range selection
- **Edit mode** (Cmd+E) to edit files directly in the diff viewer
- **Session persistence** to `.ai-review/sessions/*.json` for feeding back to AI agents
- **"Copy for AI" export** — one-click copy of session JSON to clipboard

## Plans and Session transcripts

See the [`plans/`](plans/) folder for design docs, todos, and session transcripts.

- [`plans/initial_plan/`](plans/initial_plan/) — original build plan (Phases 1–3)
  - [`plan.md`](plans/initial_plan/plan.md) — architecture and phase breakdown
  - [`todos.md`](plans/initial_plan/todos.md) — completed work and Phase 4 remaining tasks
  - [`sessions.md`](plans/initial_plan/sessions.md) — Claude Code session transcripts

- [`plans/auto-update/`](plans/auto-update/) — auto-update + release build infrastructure
  - [`plan.md`](plans/auto-update/plan.md) — updater plugin, signing, release scripts, GitHub Pages
  - [`todos.md`](plans/auto-update/todos.md) — implementation checklist
  - [`sessions.md`](plans/auto-update/sessions.md) — Claude Code session transcripts

Auto-update infrastructure and first release:

https://gisthost.github.io/?77d207405f78ac67b53db6223bd2c7b4/index.html

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run tauri dev

# Build for production
cargo tauri build
```
