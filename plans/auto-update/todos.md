# Todos — Auto-Update Plan

- [x] Generate Ed25519 signing keypair (`tauri signer generate`)
- [x] Add `tauri-plugin-updater` and `tauri-plugin-process` to `src-tauri/Cargo.toml`
- [x] Add `@tauri-apps/plugin-updater` and `@tauri-apps/plugin-process` to `package.json`
- [x] Register plugins in `src-tauri/src/lib.rs`
- [x] Configure updater endpoint + pubkey in `src-tauri/tauri.conf.json`
- [x] Create `src/hooks/useUpdater.ts`
- [x] Add update indicator UI to `src/components/layout/Toolbar.tsx`
- [x] Create `scripts/release.sh`
- [x] Create `scripts/finalize-release.sh`
- [x] Create `dsyang/readcode-releases` public repo
- [x] Enable GitHub Pages on `dsyang/readcode-releases` (branch: `gh-pages`)
