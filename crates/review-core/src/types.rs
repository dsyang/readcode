use serde::{Deserialize, Serialize};

/// A single commit in the repository, with DAG layout info.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitInfo {
    pub oid: String,
    pub short_oid: String,
    pub parent_oids: Vec<String>,
    pub author_name: String,
    pub author_email: String,
    pub timestamp: i64,
    pub summary: String,
    pub branches: Vec<String>,
    pub tags: Vec<String>,
    pub is_head: bool,
    /// DAG lane index (column) for this commit.
    pub lane: usize,
    /// DAG edges from this commit to its parents.
    pub edges: Vec<DagEdge>,
    /// Number of active lanes at this row (for SVG width).
    pub lane_count: usize,
}

/// An edge in the DAG graph connecting a commit to its parent.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DagEdge {
    /// Lane of this commit (source).
    pub from_lane: usize,
    /// Lane of the parent commit (target).
    pub to_lane: usize,
    /// Color index for this edge.
    pub color: usize,
}

/// Result of opening a repo.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoInfo {
    pub workdir: String,
    pub current_branch: Option<String>,
}

/// A range of commits (plus optionally working tree) to diff.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitRange {
    /// The selected commit OIDs, in topological order (oldest first).
    pub commits: Vec<String>,
    /// Whether to include the working tree in the diff.
    pub include_working_tree: bool,
}

/// A single file that was changed in a diff.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffFile {
    pub path: String,
    pub status: FileStatus,
    pub old_path: Option<String>,
    pub additions: u32,
    pub deletions: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum FileStatus {
    Added,
    Deleted,
    Modified,
    Renamed,
    Copied,
}

/// The result of computing a merged diff over a commit range.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergedDiff {
    pub files: Vec<DiffFile>,
    pub base_oid: Option<String>,
    pub head_description: String,
}

/// Full file contents for the diff viewer (old side + new side).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileDiffContent {
    pub path: String,
    pub old_content: String,
    pub new_content: String,
    pub status: FileStatus,
}

/// Working tree status entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkingTreeEntry {
    pub path: String,
    pub status: FileStatus,
    pub is_staged: bool,
}
