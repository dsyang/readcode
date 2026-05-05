use std::sync::Arc;

use review_core::types::RepoInfo;
use tauri::{AppHandle, Manager, State};

use super::diagnostics::{classify_error, session_id};
use super::git::{BackendState, RepoState};
use crate::remote::git_cli::RemoteRepo;
use crate::remote::profiles::{self, ConnectionProfile};

fn app_data_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("resolve app data dir: {e}"))
}

#[tauri::command]
pub async fn open_remote_repo(
    ssh_host: String,
    repo_path: String,
    state: State<'_, RepoState>,
) -> Result<RepoInfo, String> {
    match RemoteRepo::open(&ssh_host, &repo_path).await {
        Ok((repo, info)) => {
            *state.0.lock().unwrap() = BackendState::Remote(Arc::new(repo));
            tracing::info!(
                event = "remote_repo_open_success",
                session_id = %session_id(),
            );
            Ok(info)
        }
        Err(e) => {
            tracing::warn!(
                event = "remote_repo_open_failure",
                error_kind = %classify_error(&e),
                session_id = %session_id(),
            );
            Err(e)
        }
    }
}

#[tauri::command]
pub async fn disconnect_remote(state: State<'_, RepoState>) -> Result<(), String> {
    let prev = std::mem::replace(&mut *state.0.lock().unwrap(), BackendState::None);
    if let BackendState::Remote(arc) = prev {
        // Best-effort: if there are no other references, shut the shell down
        // cleanly. If another async handler is still using it, the shell
        // will be killed when the last Arc drops.
        if let Ok(repo) = Arc::try_unwrap(arc) {
            repo.shutdown().await;
        }
        tracing::info!(event = "remote_repo_disconnected", session_id = %session_id());
    }
    Ok(())
}

#[tauri::command]
pub fn list_profiles(app: AppHandle) -> Result<Vec<ConnectionProfile>, String> {
    profiles::load(&app_data_dir(&app)?)
}

#[tauri::command]
pub fn save_profile(
    profile: ConnectionProfile,
    app: AppHandle,
) -> Result<Vec<ConnectionProfile>, String> {
    profiles::upsert(&app_data_dir(&app)?, profile)
}

#[tauri::command]
pub fn delete_profile(id: String, app: AppHandle) -> Result<Vec<ConnectionProfile>, String> {
    profiles::delete(&app_data_dir(&app)?, &id)
}
