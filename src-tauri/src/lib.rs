mod commands;

use commands::git::RepoState;
use std::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(RepoState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            commands::git::open_repo,
            commands::git::get_commits,
            commands::git::get_merged_diff,
            commands::git::get_file_diff_content,
            commands::git::get_file_at_revision,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
