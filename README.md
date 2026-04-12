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

## Build Transcripts

This app was built in a single Claude Code session. Full transcript with linked commits:

https://gisthost.github.io/?6f7793b700bf2ad8af027f5f01c7ddd1/index.html

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

## Status

See [TODO.md](TODO.md) for current project status. Phases 1-3 complete, Phase 4 (remote connections) remaining.
