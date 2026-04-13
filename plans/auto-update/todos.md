# Todos — Auto-Update Plan

- [ ] Generate Ed25519 signing keypair (`tauri signer generate`)
- [ ] Add `tauri-plugin-updater` and `tauri-plugin-process` to `src-tauri/Cargo.toml`
- [ ] Add `@tauri-apps/plugin-updater` and `@tauri-apps/plugin-process` to `package.json`
- [ ] Register plugins in `src-tauri/src/lib.rs`
- [ ] Configure updater endpoint + pubkey in `src-tauri/tauri.conf.json`
- [ ] Create `src/hooks/useUpdater.ts`
- [ ] Add update indicator UI to `src/components/layout/Toolbar.tsx`
- [ ] Create `scripts/release.sh`
- [ ] Create `scripts/finalize-release.sh`
- [ ] Create `dsyang/readcode-releases` public repo
- [ ] Enable GitHub Pages on `dsyang/readcode-releases` (branch: `gh-pages`)
