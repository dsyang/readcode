use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use review_core::repo::Repo;
use review_core::types::{CommitInfo, CommitRange, FileDiffContent, MergedDiff, RepoInfo};
use tauri::State;

use super::diagnostics::{classify_error, hash_string, session_id};
use crate::remote::git_cli::RemoteRepo;

/// Active backend: local libgit2 repo, a remote shell-backed one, or none.
///
/// The local variant holds the `Repo` behind its own Mutex so sync review
/// handlers can lock it cheaply without an async runtime. The remote variant
/// holds an `Arc<RemoteRepo>` so async handlers can clone it out, drop the
/// outer lock, and then `.await` the shell without holding any Mutex guard
/// across an await point.
pub enum BackendState {
    None,
    Local(Mutex<Repo>),
    Remote(Arc<RemoteRepo>),
}

pub struct RepoState(pub Mutex<BackendState>);

impl RepoState {
    pub fn new() -> Self {
        Self(Mutex::new(BackendState::None))
    }

    /// A stable identifier for the current repo, usable as a directory name.
    /// Works for both local and remote repos.
    pub fn repo_identifier(&self) -> Result<String, String> {
        Ok(hash_string(&self.repo_path()?))
    }

    /// The user-facing path of the current repo: a local workdir for local
    /// repos or `host:/path` for remote ones.
    pub fn repo_path(&self) -> Result<String, String> {
        let guard = self.0.lock().unwrap();
        match &*guard {
            BackendState::None => Err("No repository is open".to_string()),
            BackendState::Local(m) => {
                let repo = m.lock().unwrap();
                repo.workdir()
                    .map(|p| p.to_string_lossy().to_string())
                    .ok_or_else(|| "Bare repository".to_string())
            }
            BackendState::Remote(r) => Ok(r.identifier()),
        }
    }
}

/// Snapshot the current backend without holding the outer lock. For Remote
/// we clone the `Arc` (cheap); for Local we can't clone the Mutex so we
/// return a None and expect callers to re-lock for sync access.
enum BackendSnapshot {
    Local,
    Remote(Arc<RemoteRepo>),
}

fn snapshot(state: &RepoState) -> Result<BackendSnapshot, String> {
    let guard = state.0.lock().unwrap();
    match &*guard {
        BackendState::None => Err("No repository is open".to_string()),
        BackendState::Local(_) => Ok(BackendSnapshot::Local),
        BackendState::Remote(r) => Ok(BackendSnapshot::Remote(r.clone())),
    }
}

// ── Commands ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn open_repo(path: String, state: State<'_, RepoState>) -> Result<RepoInfo, String> {
    let path_clone = path.clone();
    let start = Instant::now();
    let result = tokio::task::spawn_blocking(move || {
        Repo::open(&path_clone).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?;

    match result {
        Ok(repo) => {
            let duration_ms = start.elapsed().as_millis() as u64;
            let hashed_id = hash_string(&path);
            let info = repo.info();
            *state.0.lock().unwrap() = BackendState::Local(Mutex::new(repo));
            tracing::info!(
                event = "repo_open_success",
                hashed_repo_id = %hashed_id,
                duration_ms = duration_ms,
                session_id = %session_id(),
            );
            Ok(info)
        }
        Err(e) => {
            tracing::warn!(
                event = "repo_open_failure",
                error_kind = %classify_error(&e),
                session_id = %session_id(),
            );
            Err(e)
        }
    }
}

#[tauri::command]
pub async fn get_commits(
    max_count: Option<usize>,
    state: State<'_, RepoState>,
) -> Result<Vec<CommitInfo>, String> {
    let n = max_count.unwrap_or(50);
    let start = Instant::now();
    let commits = match snapshot(&state)? {
        BackendSnapshot::Local => {
            let guard = state.0.lock().unwrap();
            let BackendState::Local(m) = &*guard else { unreachable!() };
            let repo = m.lock().unwrap();
            repo.list_commits(n).map_err(|e| e.to_string())?
        }
        BackendSnapshot::Remote(r) => r.list_commits(n).await?,
    };
    let duration_ms = start.elapsed().as_millis() as u64;
    tracing::info!(
        event = "commits_loaded",
        count = commits.len() as u64,
        duration_ms = duration_ms,
        session_id = %session_id(),
    );
    Ok(commits)
}

#[tauri::command]
pub async fn get_commit_message(
    oid: String,
    state: State<'_, RepoState>,
) -> Result<String, String> {
    match snapshot(&state)? {
        BackendSnapshot::Local => {
            let guard = state.0.lock().unwrap();
            let BackendState::Local(m) = &*guard else { unreachable!() };
            let repo = m.lock().unwrap();
            repo.get_commit_message(&oid).map_err(|e| e.to_string())
        }
        BackendSnapshot::Remote(r) => r.get_commit_message(&oid).await,
    }
}

#[tauri::command]
pub async fn get_merged_diff(
    range: CommitRange,
    state: State<'_, RepoState>,
) -> Result<MergedDiff, String> {
    let start = Instant::now();
    let diff = match snapshot(&state)? {
        BackendSnapshot::Local => {
            let guard = state.0.lock().unwrap();
            let BackendState::Local(m) = &*guard else { unreachable!() };
            let repo = m.lock().unwrap();
            repo.get_merged_diff(&range).map_err(|e| e.to_string())?
        }
        BackendSnapshot::Remote(r) => r.get_merged_diff(&range).await?,
    };
    let duration_ms = start.elapsed().as_millis() as u64;
    let total_changed_lines: u32 = diff.files.iter().map(|f| f.additions + f.deletions).sum();
    tracing::info!(
        event = "diff_loaded",
        selected_commit_count = range.commits.len() as u64,
        file_count = diff.files.len() as u64,
        total_changed_lines = total_changed_lines as u64,
        duration_ms = duration_ms,
        session_id = %session_id(),
    );
    Ok(diff)
}

#[tauri::command]
pub async fn get_file_diff_content(
    path: String,
    range: CommitRange,
    state: State<'_, RepoState>,
) -> Result<FileDiffContent, String> {
    match snapshot(&state)? {
        BackendSnapshot::Local => {
            let guard = state.0.lock().unwrap();
            let BackendState::Local(m) = &*guard else { unreachable!() };
            let repo = m.lock().unwrap();
            repo.get_file_diff_content(&path, &range)
                .map_err(|e| e.to_string())
        }
        BackendSnapshot::Remote(r) => r.get_file_diff_content(&path, &range).await,
    }
}

#[tauri::command]
pub async fn get_file_at_revision(
    path: String,
    rev: String,
    state: State<'_, RepoState>,
) -> Result<String, String> {
    match snapshot(&state)? {
        BackendSnapshot::Local => {
            let guard = state.0.lock().unwrap();
            let BackendState::Local(m) = &*guard else { unreachable!() };
            let repo = m.lock().unwrap();
            repo.get_file_at_revision(&path, &rev)
                .map_err(|e| e.to_string())
        }
        BackendSnapshot::Remote(r) => r.get_file_at_revision(&path, &rev).await,
    }
}

#[tauri::command]
pub async fn write_file_to_workdir(
    path: String,
    content: String,
    state: State<'_, RepoState>,
) -> Result<(), String> {
    // v1: only supported for local backends. Remote edit application is
    // a follow-up task.
    let guard = state.0.lock().unwrap();
    match &*guard {
        BackendState::None => Err("No repository is open".to_string()),
        BackendState::Remote(_) => Err(
            "Writing files is not yet supported on remote connections".to_string(),
        ),
        BackendState::Local(m) => {
            let repo = m.lock().unwrap();
            let workdir = repo.workdir().ok_or("Bare repository")?;
            let full_path = workdir.join(Path::new(&path));
            std::fs::write(&full_path, &content)
                .map_err(|e| format!("Failed to write {}: {}", path, e))
        }
    }
}
