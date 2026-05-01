use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

use crate::error::ReviewError;

// ── Top-level session file ──────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewSession {
    pub version: String,
    pub session: SessionMeta,
    pub comments: Vec<Comment>,
    pub edits: Vec<Edit>,
    pub summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionMeta {
    pub id: String,
    pub repo: String,
    pub review_location: String,
    pub branch: Option<String>,
    pub base_commit: Option<String>,
    pub head_commit: String,
    pub reviewed_commits: Vec<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// ── Comments ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Comment {
    pub id: String,
    #[serde(rename = "type")]
    pub comment_type: CommentType,
    pub file: String,
    pub line_range: LineRange,
    pub body: String,
    pub severity: Severity,
    pub resolved: bool,
    pub created_at: DateTime<Utc>,
    pub context: CommentContext,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CommentType {
    Comment,
    Suggestion,
    Issue,
    AutoEdit,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LineRange {
    pub side: DiffSide,
    pub start: u32,
    pub end: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiffSide {
    Old,
    New,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    Info,
    Warning,
    Error,
    Suggestion,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommentContext {
    pub before: String,
    pub content: String,
    pub after: String,
}

// ── Edits ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Edit {
    pub id: String,
    pub file: String,
    pub line_range: EditLineRange,
    pub old_content: String,
    pub new_content: String,
    pub description: String,
    pub applied_at: DateTime<Utc>,
    pub associated_comment_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EditLineRange {
    pub start: u32,
    pub end: u32,
}

// ── Persistence ─────────────────────────────────────────────────────

fn sessions_dir(storage_dir: &Path) -> PathBuf {
    storage_dir.join("sessions")
}

fn session_path(storage_dir: &Path, session_id: &str) -> PathBuf {
    sessions_dir(storage_dir).join(format!("{}.json", session_id))
}

impl ReviewSession {
    /// Create a new empty session.
    pub fn new(
        repo: String,
        review_location: String,
        branch: Option<String>,
        base_commit: Option<String>,
        head_commit: String,
        reviewed_commits: Vec<String>,
    ) -> Self {
        let now = Utc::now();
        Self {
            version: "1.0".to_string(),
            session: SessionMeta {
                id: Uuid::new_v4().to_string(),
                repo,
                review_location,
                branch,
                base_commit,
                head_commit,
                reviewed_commits,
                created_at: now,
                updated_at: now,
            },
            comments: Vec::new(),
            edits: Vec::new(),
            summary: None,
        }
    }

    /// Save to `{storage_dir}/sessions/{id}.json`.
    pub fn save(&self, storage_dir: &Path) -> Result<PathBuf, ReviewError> {
        let dir = sessions_dir(storage_dir);
        fs::create_dir_all(&dir).map_err(|e| ReviewError::Other(e.to_string()))?;

        let path = session_path(storage_dir, &self.session.id);
        let json = serde_json::to_string_pretty(self)
            .map_err(|e| ReviewError::Other(e.to_string()))?;
        fs::write(&path, json).map_err(|e| ReviewError::Other(e.to_string()))?;
        Ok(path)
    }

    /// Load a session from disk.
    pub fn load(storage_dir: &Path, session_id: &str) -> Result<Self, ReviewError> {
        let path = session_path(storage_dir, session_id);
        let json = fs::read_to_string(&path)
            .map_err(|_| ReviewError::Other(format!("Session not found: {}", session_id)))?;
        serde_json::from_str(&json).map_err(|e| ReviewError::Other(e.to_string()))
    }

    /// List all active (non-ended) session IDs.
    pub fn list_active(storage_dir: &Path) -> Result<Vec<String>, ReviewError> {
        let dir = sessions_dir(storage_dir);
        if !dir.exists() {
            return Ok(Vec::new());
        }
        let mut ids = Vec::new();
        for entry in fs::read_dir(&dir).map_err(|e| ReviewError::Other(e.to_string()))? {
            let entry = entry.map_err(|e| ReviewError::Other(e.to_string()))?;
            let name = entry.file_name().to_string_lossy().to_string();
            if name.contains("-ended") {
                continue;
            }
            if let Some(id) = name.strip_suffix(".json") {
                ids.push(id.to_string());
            }
        }
        Ok(ids)
    }

    /// End a session: rename its file to {id}-ended.json.
    pub fn end(storage_dir: &Path, session_id: &str) -> Result<(), ReviewError> {
        let from = session_path(storage_dir, session_id);
        let to = sessions_dir(storage_dir).join(format!("{}-ended.json", session_id));
        if from.exists() {
            fs::rename(&from, &to).map_err(|e| ReviewError::Other(e.to_string()))?;
        }
        Ok(())
    }

    /// Add a comment and auto-save.
    pub fn add_comment(
        &mut self,
        file: String,
        line_range: LineRange,
        body: String,
        comment_type: CommentType,
        severity: Severity,
        context: CommentContext,
    ) -> String {
        let id = Uuid::new_v4().to_string();
        self.comments.push(Comment {
            id: id.clone(),
            comment_type,
            file,
            line_range,
            body,
            severity,
            resolved: false,
            created_at: Utc::now(),
            context,
        });
        self.session.updated_at = Utc::now();
        id
    }

    /// Toggle resolved on a comment.
    pub fn toggle_resolved(&mut self, comment_id: &str) -> bool {
        if let Some(c) = self.comments.iter_mut().find(|c| c.id == comment_id) {
            c.resolved = !c.resolved;
            self.session.updated_at = Utc::now();
            return c.resolved;
        }
        false
    }

    /// Delete a comment.
    pub fn delete_comment(&mut self, comment_id: &str) -> bool {
        let before = self.comments.len();
        self.comments.retain(|c| c.id != comment_id);
        if self.comments.len() != before {
            self.session.updated_at = Utc::now();
            true
        } else {
            false
        }
    }

    /// Add an edit record.
    pub fn add_edit(
        &mut self,
        file: String,
        line_range: EditLineRange,
        old_content: String,
        new_content: String,
        description: String,
        associated_comment_id: Option<String>,
    ) -> String {
        let id = Uuid::new_v4().to_string();
        self.edits.push(Edit {
            id: id.clone(),
            file,
            line_range,
            old_content,
            new_content,
            description,
            applied_at: Utc::now(),
            associated_comment_id,
        });
        self.session.updated_at = Utc::now();
        id
    }

    /// Export as formatted JSON string.
    pub fn export_json(&self) -> Result<String, ReviewError> {
        serde_json::to_string_pretty(self).map_err(|e| ReviewError::Other(e.to_string()))
    }
}
