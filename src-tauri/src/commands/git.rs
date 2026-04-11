use std::sync::Mutex;

use review_core::repo::Repo;
use review_core::types::{CommitInfo, CommitRange, FileDiffContent, MergedDiff, RepoInfo};
use tauri::State;

pub struct RepoState(pub Mutex<Option<Repo>>);

#[tauri::command]
pub fn open_repo(path: String, state: State<RepoState>) -> Result<RepoInfo, String> {
    let repo = Repo::open(&path).map_err(|e| e.to_string())?;
    let info = repo.info();
    *state.0.lock().unwrap() = Some(repo);
    Ok(info)
}

#[tauri::command]
pub fn get_commits(max_count: Option<usize>, state: State<RepoState>) -> Result<Vec<CommitInfo>, String> {
    let guard = state.0.lock().unwrap();
    let repo = guard.as_ref().ok_or("No repository is open")?;
    repo.list_commits(max_count.unwrap_or(50))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_merged_diff(range: CommitRange, state: State<RepoState>) -> Result<MergedDiff, String> {
    let guard = state.0.lock().unwrap();
    let repo = guard.as_ref().ok_or("No repository is open")?;
    repo.get_merged_diff(&range).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_file_diff_content(
    path: String,
    range: CommitRange,
    state: State<RepoState>,
) -> Result<FileDiffContent, String> {
    let guard = state.0.lock().unwrap();
    let repo = guard.as_ref().ok_or("No repository is open")?;
    repo.get_file_diff_content(&path, &range)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_file_at_revision(
    path: String,
    rev: String,
    state: State<RepoState>,
) -> Result<String, String> {
    let guard = state.0.lock().unwrap();
    let repo = guard.as_ref().ok_or("No repository is open")?;
    repo.get_file_at_revision(&path, &rev)
        .map_err(|e| e.to_string())
}
