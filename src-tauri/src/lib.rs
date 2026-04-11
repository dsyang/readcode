mod commands;

use commands::git::RepoState;
use commands::review::SessionState;
use std::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(RepoState(Mutex::new(None)))
        .manage(SessionState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            commands::git::open_repo,
            commands::git::get_commits,
            commands::git::get_merged_diff,
            commands::git::get_file_diff_content,
            commands::git::get_file_at_revision,
            commands::git::write_file_to_workdir,
            commands::review::create_session,
            commands::review::get_session,
            commands::review::load_session,
            commands::review::list_sessions,
            commands::review::add_comment,
            commands::review::toggle_comment_resolved,
            commands::review::delete_comment,
            commands::review::add_edit,
            commands::review::export_session,
            commands::review::set_session_summary,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
