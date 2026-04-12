use std::sync::Mutex;
use std::time::Instant;

use review_core::repo::Repo;
use review_core::types::{CommitInfo, CommitRange, FileDiffContent, MergedDiff, RepoInfo};
use tauri::State;
use std::path::Path;

use super::diagnostics::{classify_error, hash_string, session_id};

pub struct RepoState(pub Mutex<Option<Repo>>);

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
            *state.0.lock().unwrap() = Some(repo);
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
pub async fn get_commits(max_count: Option<usize>, state: State<'_, RepoState>) -> Result<Vec<CommitInfo>, String> {
    let guard = state.0.lock().unwrap();
    let repo = guard.as_ref().ok_or("No repository is open")?;
    let start = Instant::now();
    let commits = repo.list_commits(max_count.unwrap_or(50)).map_err(|e| e.to_string())?;
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
pub async fn get_merged_diff(range: CommitRange, state: State<'_, RepoState>) -> Result<MergedDiff, String> {
    let guard = state.0.lock().unwrap();
    let repo = guard.as_ref().ok_or("No repository is open")?;
    let start = Instant::now();
    let diff = repo.get_merged_diff(&range).map_err(|e| e.to_string())?;
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
    let guard = state.0.lock().unwrap();
    let repo = guard.as_ref().ok_or("No repository is open")?;
    repo.get_file_diff_content(&path, &range)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_file_at_revision(
    path: String,
    rev: String,
    state: State<'_, RepoState>,
) -> Result<String, String> {
    let guard = state.0.lock().unwrap();
    let repo = guard.as_ref().ok_or("No repository is open")?;
    repo.get_file_at_revision(&path, &rev)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn write_file_to_workdir(
    path: String,
    content: String,
    state: State<'_, RepoState>,
) -> Result<(), String> {
    let guard = state.0.lock().unwrap();
    let repo = guard.as_ref().ok_or("No repository is open")?;
    let workdir = repo.workdir().ok_or("Bare repository")?;
    let full_path = workdir.join(Path::new(&path));
    std::fs::write(&full_path, &content)
        .map_err(|e| format!("Failed to write {}: {}", path, e))
}
