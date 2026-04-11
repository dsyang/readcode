use thiserror::Error;

#[derive(Debug, Error)]
pub enum ReviewError {
    #[error("Git error: {0}")]
    Git(#[from] git2::Error),

    #[error("Repository not found at {0}")]
    RepoNotFound(String),

    #[error("Commit not found: {0}")]
    CommitNotFound(String),

    #[error("File not found: {path} at revision {rev}")]
    FileNotFound { path: String, rev: String },

    #[error("No commits selected")]
    NoCommitsSelected,

    #[error("{0}")]
    Other(String),
}

impl Serialize for ReviewError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

use serde::Serialize;
