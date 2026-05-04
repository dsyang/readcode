use std::path::PathBuf;
use std::sync::OnceLock;

use sha2::Digest;
use tauri::State;

/// Global session ID set once at app startup, shared across all log calls.
pub static SESSION_ID: OnceLock<String> = OnceLock::new();

pub fn session_id() -> &'static str {
    SESSION_ID.get().map(|s| s.as_str()).unwrap_or("unknown")
}

pub struct DiagnosticsState {
    pub log_path: PathBuf,
}

#[derive(serde::Deserialize)]
pub struct FrontendEvent {
    pub event: String,
    pub payload: serde_json::Value,
}

/// Maps error message strings to safe, non-private error kind labels.
pub fn classify_error(msg: &str) -> &'static str {
    if msg.contains("not found") || msg.contains("Repository not found") {
        "not_found"
    } else if msg.contains("permission") || msg.contains("Permission") {
        "permission_denied"
    } else if msg.contains("No repository") {
        "no_repo_open"
    } else if msg.contains("No active session") {
        "no_session"
    } else if msg.contains("Bare repository") {
        "bare_repo"
    } else if msg.contains("No commits selected") {
        "no_commits_selected"
    } else {
        "unknown"
    }
}

/// Hashes an input string to an 8-character lowercase hex string (first 4 bytes of SHA-256).
/// Used to correlate events from the same repo without logging the path.
pub fn hash_string(input: &str) -> String {
    let mut hasher = sha2::Sha256::new();
    hasher.update(input.as_bytes());
    let result = hasher.finalize();
    hex::encode(&result[..4])
}

/// Returns the set of field names that are safe to log for a given event type.
/// Any field not in this list is silently dropped by `sanitize`.
fn allowed_fields(event: &str) -> &'static [&'static str] {
    match event {
        "repo_open_attempt" => &[],
        "repo_open_success" => &["hashed_repo_id", "commit_count", "duration_ms"],
        "repo_open_failure" => &["error_kind"],
        "commits_loaded" => &["count", "duration_ms"],
        "diff_loaded" => &["selected_commit_count", "file_count", "total_changed_lines", "duration_ms"],
        "file_selected" => &["count"],
        "session_created" => &[],
        "session_loaded" => &[],
        "session_ended" => &["comment_count", "edit_count", "duration_ms"],
        "session_exported" => &[],
        "session_abandoned" => &["comment_count", "edit_count"],
        "comment_added" => &["severity", "comment_type"],
        "comment_resolved" => &[],
        "comment_deleted" => &[],
        "edit_applied" => &[],
        "ipc_error" => &["command_name", "error_kind"],
        "js_error" => &["error_class", "component_stack_depth"],
        "app_context" => &["screen_width", "screen_height", "locale"],
        "updater_check" => &["available", "current_version", "latest_version"],
        "updater_error" => &["error_kind"],
        _ => &[],
    }
}

/// Returns true if a string value is safe to log (no path separators, not too long).
fn is_safe_string(s: &str) -> bool {
    if s.len() > 64 {
        return false;
    }
    // Heuristic: strings with path separators are likely file paths
    if s.contains('/') || s.contains('\\') {
        return false;
    }
    true
}

/// Sanitizes a frontend event payload, enforcing the field allowlist and
/// redacting any string values that look like file paths.
pub fn sanitize(event: &str, payload: serde_json::Value) -> serde_json::Value {
    let allowed = allowed_fields(event);
    let obj = match payload {
        serde_json::Value::Object(map) => map,
        _ => return serde_json::Value::Object(serde_json::Map::new()),
    };

    let mut result = serde_json::Map::new();
    let mut redacted = false;

    for (key, value) in obj {
        if !allowed.contains(&key.as_str()) {
            continue;
        }
        match &value {
            serde_json::Value::String(s) => {
                if is_safe_string(s) {
                    result.insert(key, value);
                } else {
                    result.insert(key, serde_json::Value::String("[REDACTED]".to_string()));
                    redacted = true;
                }
            }
            serde_json::Value::Number(_) | serde_json::Value::Bool(_) | serde_json::Value::Null => {
                result.insert(key, value);
            }
            // Drop arrays and nested objects — not expected in any event payload
            _ => {}
        }
    }

    if redacted {
        tracing::warn!(
            event = "sanitizer_redacted",
            original_event = %event,
            session_id = %session_id(),
        );
    }

    serde_json::Value::Object(result)
}

// ── IPC Commands ─────────────────────────────────────────────────────

/// Accepts a structured event from the frontend, sanitizes it, and writes it
/// to the log file via the tracing infrastructure.
#[tauri::command]
pub fn log_event(
    event: FrontendEvent,
    _state: State<'_, DiagnosticsState>,
) -> Result<(), String> {
    let clean_payload = sanitize(&event.event, event.payload);
    tracing::info!(
        event = %event.event,
        payload = %clean_payload,
        session_id = %session_id(),
        source = "frontend",
    );
    Ok(())
}

/// Returns the path to the log directory so the frontend can open it for the user.
#[tauri::command]
pub fn get_log_path(state: State<'_, DiagnosticsState>) -> Result<String, String> {
    Ok(state.log_path.to_string_lossy().to_string())
}

/// Hashes an input string to an 8-char hex ID. Used by the frontend to hash
/// repo paths before logging them, ensuring no raw paths appear in logs.
#[tauri::command]
pub fn hash_string_cmd(input: String) -> Result<String, String> {
    Ok(hash_string(&input))
}
