use std::sync::Arc;
use std::time::Instant;

use review_core::types::RepoInfo;
use tauri::{AppHandle, Manager, State};

use super::diagnostics::{classify_error, log_ipc_call, session_id};
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
    let start = Instant::now();
    let result: Result<RepoInfo, String> = async {
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
    .await;
    log_ipc_call("open_remote_repo", start, &result);
    result
}

#[tauri::command]
pub async fn disconnect_remote(state: State<'_, RepoState>) -> Result<(), String> {
    let start = Instant::now();
    let result: Result<(), String> = async {
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
    .await;
    log_ipc_call("disconnect_remote", start, &result);
    result
}

#[tauri::command]
pub fn list_profiles(app: AppHandle) -> Result<Vec<ConnectionProfile>, String> {
    let start = Instant::now();
    let result = (|| profiles::load(&app_data_dir(&app)?))();
    log_ipc_call("list_profiles", start, &result);
    result
}

#[tauri::command]
pub fn save_profile(
    profile: ConnectionProfile,
    app: AppHandle,
) -> Result<Vec<ConnectionProfile>, String> {
    let start = Instant::now();
    let result = (|| profiles::upsert(&app_data_dir(&app)?, profile))();
    log_ipc_call("save_profile", start, &result);
    result
}

#[tauri::command]
pub fn delete_profile(id: String, app: AppHandle) -> Result<Vec<ConnectionProfile>, String> {
    let start = Instant::now();
    let result = (|| profiles::delete(&app_data_dir(&app)?, &id))();
    log_ipc_call("delete_profile", start, &result);
    result
}
