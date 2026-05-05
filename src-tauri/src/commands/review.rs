use std::path::PathBuf;
use std::sync::Mutex;

use review_core::review::{
    CommentContext, CommentType, DiffSide, EditLineRange, LineRange, ReviewSession, Severity,
};
use tauri::{AppHandle, Manager, State};

use super::diagnostics::session_id as diag_session_id;
use super::git::RepoState;

pub struct SessionState(pub Mutex<Option<ReviewSession>>);

// ── DTOs for IPC (serde-friendly) ───────────────────────────────────

#[derive(serde::Deserialize)]
pub struct AddCommentArgs {
    pub file: String,
    pub side: String,
    pub start_line: u32,
    pub end_line: u32,
    pub body: String,
    pub comment_type: String,
    pub severity: String,
    pub context_before: String,
    pub context_content: String,
    pub context_after: String,
}

#[derive(serde::Deserialize)]
pub struct AddEditArgs {
    pub file: String,
    pub start_line: u32,
    pub end_line: u32,
    pub old_content: String,
    pub new_content: String,
    pub description: String,
    pub associated_comment_id: Option<String>,
}

fn parse_side(s: &str) -> DiffSide {
    match s {
        "old" => DiffSide::Old,
        _ => DiffSide::New,
    }
}

fn parse_comment_type(s: &str) -> CommentType {
    match s {
        "suggestion" => CommentType::Suggestion,
        "issue" => CommentType::Issue,
        "auto_edit" => CommentType::AutoEdit,
        _ => CommentType::Comment,
    }
}

fn parse_severity(s: &str) -> Severity {
    match s {
        "warning" => Severity::Warning,
        "error" => Severity::Error,
        "suggestion" => Severity::Suggestion,
        _ => Severity::Info,
    }
}

/// Compute the local storage directory for the current repo's review
/// sessions.  Lives under the Tauri app data dir, keyed by a hash of
/// the repo path (works for both local and remote repos).
fn review_storage_dir(app: &AppHandle, repo_state: &RepoState) -> Result<PathBuf, String> {
    let repo_id = repo_state.repo_identifier()?;
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("resolve app data dir: {e}"))?;
    Ok(base.join("reviews").join(repo_id))
}

// ── Commands ────────────────────────────────────────────────────────

#[tauri::command]
pub fn create_session(
    branch: Option<String>,
    base_commit: Option<String>,
    head_commit: String,
    reviewed_commits: Vec<String>,
    app: AppHandle,
    repo_state: State<RepoState>,
    session_state: State<SessionState>,
) -> Result<ReviewSession, String> {
    let storage = review_storage_dir(&app, &repo_state)?;
    let repo_path = repo_state.repo_path()?;

    let session = ReviewSession::new(
        repo_path,
        storage.to_string_lossy().to_string(),
        branch,
        base_commit,
        head_commit,
        reviewed_commits,
    );
    session.save(&storage).map_err(|e| e.to_string())?;

    let result = session.clone();
    *session_state.0.lock().unwrap() = Some(session);

    tracing::info!(event = "session_created", session_id = %diag_session_id());

    Ok(result)
}

#[tauri::command]
pub fn get_session(session_state: State<SessionState>) -> Result<Option<ReviewSession>, String> {
    let guard = session_state.0.lock().unwrap();
    Ok(guard.clone())
}

#[tauri::command]
pub fn load_session(
    session_id: String,
    app: AppHandle,
    repo_state: State<RepoState>,
    session_state: State<SessionState>,
) -> Result<ReviewSession, String> {
    let storage = review_storage_dir(&app, &repo_state)?;
    let session = ReviewSession::load(&storage, &session_id).map_err(|e| e.to_string())?;
    let result = session.clone();
    *session_state.0.lock().unwrap() = Some(session);

    tracing::info!(event = "session_loaded", session_id = %diag_session_id());

    Ok(result)
}

#[tauri::command]
pub fn list_active_sessions(
    app: AppHandle,
    repo_state: State<RepoState>,
) -> Result<Vec<String>, String> {
    let storage = review_storage_dir(&app, &repo_state)?;
    ReviewSession::list_active(&storage).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn discard_session(
    session_id: String,
    app: AppHandle,
    repo_state: State<RepoState>,
) -> Result<(), String> {
    let storage = review_storage_dir(&app, &repo_state)?;
    ReviewSession::discard(&storage, &session_id).map_err(|e| e.to_string())?;

    tracing::info!(event = "session_discarded", session_id = %diag_session_id());

    Ok(())
}

#[tauri::command]
pub fn end_session(
    app: AppHandle,
    repo_state: State<RepoState>,
    session_state: State<SessionState>,
) -> Result<(), String> {
    let mut guard = session_state.0.lock().unwrap();
    if let Some(session) = guard.take() {
        let comment_count = session.comments.len() as u64;
        let edit_count = session.edits.len() as u64;

        let storage = review_storage_dir(&app, &repo_state)?;
        ReviewSession::end(&storage, &session.session.id).map_err(|e| e.to_string())?;

        tracing::info!(
            event = "session_ended",
            comment_count = comment_count,
            edit_count = edit_count,
            session_id = %diag_session_id(),
        );
    }
    Ok(())
}

#[tauri::command]
pub fn add_comment(
    args: AddCommentArgs,
    app: AppHandle,
    repo_state: State<RepoState>,
    session_state: State<SessionState>,
) -> Result<ReviewSession, String> {
    let severity = args.severity.clone();
    let comment_type = args.comment_type.clone();

    let mut guard = session_state.0.lock().unwrap();
    let session = guard.as_mut().ok_or("No active session")?;

    session.add_comment(
        args.file,
        LineRange {
            side: parse_side(&args.side),
            start: args.start_line,
            end: args.end_line,
        },
        args.body,
        parse_comment_type(&args.comment_type),
        parse_severity(&args.severity),
        CommentContext {
            before: args.context_before,
            content: args.context_content,
            after: args.context_after,
        },
    );

    let storage = review_storage_dir(&app, &repo_state)?;
    session.save(&storage).map_err(|e| e.to_string())?;

    tracing::info!(
        event = "comment_added",
        severity = %severity,
        comment_type = %comment_type,
        session_id = %diag_session_id(),
    );

    Ok(session.clone())
}

#[tauri::command]
pub fn toggle_comment_resolved(
    comment_id: String,
    app: AppHandle,
    repo_state: State<RepoState>,
    session_state: State<SessionState>,
) -> Result<ReviewSession, String> {
    let mut guard = session_state.0.lock().unwrap();
    let session = guard.as_mut().ok_or("No active session")?;
    session.toggle_resolved(&comment_id);

    let storage = review_storage_dir(&app, &repo_state)?;
    session.save(&storage).map_err(|e| e.to_string())?;

    tracing::info!(event = "comment_resolved", session_id = %diag_session_id());

    Ok(session.clone())
}

#[tauri::command]
pub fn delete_comment(
    comment_id: String,
    app: AppHandle,
    repo_state: State<RepoState>,
    session_state: State<SessionState>,
) -> Result<ReviewSession, String> {
    let mut guard = session_state.0.lock().unwrap();
    let session = guard.as_mut().ok_or("No active session")?;
    session.delete_comment(&comment_id);

    let storage = review_storage_dir(&app, &repo_state)?;
    session.save(&storage).map_err(|e| e.to_string())?;

    tracing::info!(event = "comment_deleted", session_id = %diag_session_id());

    Ok(session.clone())
}

#[tauri::command]
pub fn add_edit(
    args: AddEditArgs,
    app: AppHandle,
    repo_state: State<RepoState>,
    session_state: State<SessionState>,
) -> Result<ReviewSession, String> {
    let mut guard = session_state.0.lock().unwrap();
    let session = guard.as_mut().ok_or("No active session")?;

    session.add_edit(
        args.file,
        EditLineRange {
            start: args.start_line,
            end: args.end_line,
        },
        args.old_content,
        args.new_content,
        args.description,
        args.associated_comment_id,
    );

    let storage = review_storage_dir(&app, &repo_state)?;
    session.save(&storage).map_err(|e| e.to_string())?;

    tracing::info!(event = "edit_applied", session_id = %diag_session_id());

    Ok(session.clone())
}

#[tauri::command]
pub fn export_session(session_state: State<SessionState>) -> Result<String, String> {
    let guard = session_state.0.lock().unwrap();
    let session = guard.as_ref().ok_or("No active session")?;
    let result = session.export_json().map_err(|e| e.to_string())?;

    tracing::info!(event = "session_exported", session_id = %diag_session_id());

    Ok(result)
}

#[tauri::command]
pub fn set_session_summary(
    summary: String,
    app: AppHandle,
    repo_state: State<RepoState>,
    session_state: State<SessionState>,
) -> Result<ReviewSession, String> {
    let mut guard = session_state.0.lock().unwrap();
    let session = guard.as_mut().ok_or("No active session")?;
    session.summary = if summary.is_empty() {
        None
    } else {
        Some(summary)
    };

    let storage = review_storage_dir(&app, &repo_state)?;
    session.save(&storage).map_err(|e| e.to_string())?;

    Ok(session.clone())
}
