use std::sync::Mutex;

use review_core::review::{
    CommentContext, CommentType, DiffSide, EditLineRange, LineRange, ReviewSession, Severity,
};
use tauri::State;

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

// ── Commands ────────────────────────────────────────────────────────

#[tauri::command]
pub fn create_session(
    branch: Option<String>,
    base_commit: Option<String>,
    head_commit: String,
    reviewed_commits: Vec<String>,
    repo_state: State<RepoState>,
    session_state: State<SessionState>,
) -> Result<ReviewSession, String> {
    let repo_guard = repo_state.0.lock().unwrap();
    let repo = repo_guard.as_ref().ok_or("No repository is open")?;
    let workdir = repo
        .workdir()
        .ok_or("Bare repository")?
        .to_string_lossy()
        .to_string();

    let session = ReviewSession::new(workdir.clone(), branch, base_commit, head_commit, reviewed_commits);
    session.save(std::path::Path::new(&workdir)).map_err(|e| e.to_string())?;

    let result = session.clone();
    *session_state.0.lock().unwrap() = Some(session);
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
    repo_state: State<RepoState>,
    session_state: State<SessionState>,
) -> Result<ReviewSession, String> {
    let repo_guard = repo_state.0.lock().unwrap();
    let repo = repo_guard.as_ref().ok_or("No repository is open")?;
    let workdir = repo.workdir().ok_or("Bare repository")?;

    let session = ReviewSession::load(workdir, &session_id).map_err(|e| e.to_string())?;
    let result = session.clone();
    *session_state.0.lock().unwrap() = Some(session);
    Ok(result)
}

#[tauri::command]
pub fn list_active_sessions(repo_state: State<RepoState>) -> Result<Vec<String>, String> {
    let repo_guard = repo_state.0.lock().unwrap();
    let repo = repo_guard.as_ref().ok_or("No repository is open")?;
    let workdir = repo.workdir().ok_or("Bare repository")?;
    ReviewSession::list_active(workdir).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn end_session(
    repo_state: State<RepoState>,
    session_state: State<SessionState>,
) -> Result<(), String> {
    let mut guard = session_state.0.lock().unwrap();
    if let Some(session) = guard.take() {
        let repo_guard = repo_state.0.lock().unwrap();
        let repo = repo_guard.as_ref().ok_or("No repository is open")?;
        let workdir = repo.workdir().ok_or("Bare repository")?;
        ReviewSession::end(workdir, &session.session.id).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn add_comment(
    args: AddCommentArgs,
    repo_state: State<RepoState>,
    session_state: State<SessionState>,
) -> Result<ReviewSession, String> {
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

    // Auto-save
    let repo_guard = repo_state.0.lock().unwrap();
    let repo = repo_guard.as_ref().ok_or("No repository is open")?;
    let workdir = repo.workdir().ok_or("Bare repository")?;
    session.save(workdir).map_err(|e| e.to_string())?;

    Ok(session.clone())
}

#[tauri::command]
pub fn toggle_comment_resolved(
    comment_id: String,
    repo_state: State<RepoState>,
    session_state: State<SessionState>,
) -> Result<ReviewSession, String> {
    let mut guard = session_state.0.lock().unwrap();
    let session = guard.as_mut().ok_or("No active session")?;
    session.toggle_resolved(&comment_id);

    let repo_guard = repo_state.0.lock().unwrap();
    let repo = repo_guard.as_ref().ok_or("No repository is open")?;
    let workdir = repo.workdir().ok_or("Bare repository")?;
    session.save(workdir).map_err(|e| e.to_string())?;

    Ok(session.clone())
}

#[tauri::command]
pub fn delete_comment(
    comment_id: String,
    repo_state: State<RepoState>,
    session_state: State<SessionState>,
) -> Result<ReviewSession, String> {
    let mut guard = session_state.0.lock().unwrap();
    let session = guard.as_mut().ok_or("No active session")?;
    session.delete_comment(&comment_id);

    let repo_guard = repo_state.0.lock().unwrap();
    let repo = repo_guard.as_ref().ok_or("No repository is open")?;
    let workdir = repo.workdir().ok_or("Bare repository")?;
    session.save(workdir).map_err(|e| e.to_string())?;

    Ok(session.clone())
}

#[tauri::command]
pub fn add_edit(
    args: AddEditArgs,
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

    let repo_guard = repo_state.0.lock().unwrap();
    let repo = repo_guard.as_ref().ok_or("No repository is open")?;
    let workdir = repo.workdir().ok_or("Bare repository")?;
    session.save(workdir).map_err(|e| e.to_string())?;

    Ok(session.clone())
}

#[tauri::command]
pub fn export_session(session_state: State<SessionState>) -> Result<String, String> {
    let guard = session_state.0.lock().unwrap();
    let session = guard.as_ref().ok_or("No active session")?;
    session.export_json().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_session_summary(
    summary: String,
    repo_state: State<RepoState>,
    session_state: State<SessionState>,
) -> Result<ReviewSession, String> {
    let mut guard = session_state.0.lock().unwrap();
    let session = guard.as_mut().ok_or("No active session")?;
    session.summary = if summary.is_empty() { None } else { Some(summary) };

    let repo_guard = repo_state.0.lock().unwrap();
    let repo = repo_guard.as_ref().ok_or("No repository is open")?;
    let workdir = repo.workdir().ok_or("Bare repository")?;
    session.save(workdir).map_err(|e| e.to_string())?;

    Ok(session.clone())
}
