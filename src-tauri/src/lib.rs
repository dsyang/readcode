mod commands;
mod remote;

use commands::diagnostics::DiagnosticsState;
use commands::git::RepoState;
use commands::review::SessionState;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;
use tracing_appender::non_blocking::WorkerGuard;

fn cleanup_old_logs(log_dir: &PathBuf) {
    let cutoff = std::time::SystemTime::now()
        .checked_sub(std::time::Duration::from_secs(7 * 24 * 60 * 60))
        .unwrap_or(std::time::UNIX_EPOCH);

    if let Ok(entries) = std::fs::read_dir(log_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let name = path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned();
            if name.starts_with("readcode.log") {
                if let Ok(metadata) = entry.metadata() {
                    if let Ok(modified) = metadata.modified() {
                        if modified < cutoff {
                            let _ = std::fs::remove_file(&path);
                        }
                    }
                }
            }
        }
    }
}

fn init_tracing(app: &tauri::App) -> (WorkerGuard, PathBuf) {
    use tracing_subscriber::prelude::*;
    use tracing_subscriber::{fmt, EnvFilter};

    let log_dir = app
        .path()
        .app_log_dir()
        .expect("failed to resolve app log dir");

    std::fs::create_dir_all(&log_dir).expect("failed to create log dir");
    cleanup_old_logs(&log_dir);

    let file_appender = tracing_appender::rolling::daily(&log_dir, "readcode.log");
    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);

    let file_layer = fmt::Layer::new()
        .json()
        .with_ansi(false)
        .with_writer(non_blocking);

    tracing_subscriber::registry()
        .with(EnvFilter::new("info"))
        .with(file_layer)
        .init();

    (guard, log_dir)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let (guard, log_path) = init_tracing(app);
            // Leak the guard so the background writer thread lives for the
            // entire process lifetime and flushes buffered events on exit.
            Box::leak(Box::new(guard));

            let session_id = uuid::Uuid::new_v4().to_string();
            commands::diagnostics::SESSION_ID
                .set(session_id.clone())
                .ok();

            tracing::info!(
                event = "app_started",
                version = env!("CARGO_PKG_VERSION"),
                os = std::env::consts::OS,
                arch = std::env::consts::ARCH,
                session_id = %session_id,
            );

            app.manage(DiagnosticsState { log_path });
            Ok(())
        })
        .manage(RepoState::new())
        .manage(SessionState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            commands::git::open_repo,
            commands::git::get_commits,
            commands::git::get_commit_message,
            commands::git::get_merged_diff,
            commands::git::get_file_diff_content,
            commands::git::get_file_at_revision,
            commands::git::write_file_to_workdir,
            commands::remote::open_remote_repo,
            commands::remote::disconnect_remote,
            commands::remote::list_profiles,
            commands::remote::save_profile,
            commands::remote::delete_profile,
            commands::review::create_session,
            commands::review::get_session,
            commands::review::load_session,
            commands::review::list_active_sessions,
            commands::review::discard_session,
            commands::review::end_session,
            commands::review::add_comment,
            commands::review::toggle_comment_resolved,
            commands::review::delete_comment,
            commands::review::add_edit,
            commands::review::export_session,
            commands::review::set_session_summary,
            commands::diagnostics::log_event,
            commands::diagnostics::get_log_path,
            commands::diagnostics::hash_string_cmd,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_app_handle, event| {
        if let tauri::RunEvent::ExitRequested { .. } = event {
            tracing::info!(
                event = "app_quit",
                session_id = %commands::diagnostics::session_id(),
            );
        }
    });
}
