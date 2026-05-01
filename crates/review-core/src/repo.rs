use git2::{BranchType, Oid, Repository, Sort};
use std::collections::HashMap;
use std::path::Path;

use crate::dag::{assemble_commits, RawCommit};
use crate::error::ReviewError;
use crate::types::{CommitInfo, RepoInfo};

/// Wrapper around a local git repository.
pub struct Repo {
    inner: Repository,
}

impl Repo {
    /// Open a repository at the given path (discovers .git automatically).
    pub fn open(path: &str) -> Result<Self, ReviewError> {
        let repo = Repository::discover(path)
            .map_err(|_| ReviewError::RepoNotFound(path.to_string()))?;
        Ok(Self { inner: repo })
    }

    /// Get the path to the repository's work directory.
    pub fn workdir(&self) -> Option<&Path> {
        self.inner.workdir()
    }

    pub fn inner(&self) -> &Repository {
        &self.inner
    }

    /// Get repo info (workdir + current branch).
    pub fn info(&self) -> RepoInfo {
        let workdir = self
            .workdir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        let current_branch = self
            .inner
            .head()
            .ok()
            .and_then(|h| {
                if h.is_branch() {
                    h.shorthand().map(|s| s.to_string())
                } else {
                    None
                }
            });
        RepoInfo {
            workdir,
            current_branch,
        }
    }

    /// List commits with DAG lane layout, in topological order (newest first).
    /// Walks HEAD's ancestors only, so commits[0] is always the checked-out tip.
    pub fn list_commits(&self, max_count: usize) -> Result<Vec<CommitInfo>, ReviewError> {
        let mut revwalk = self.inner.revwalk()?;
        revwalk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME)?;

        if let Ok(head) = self.inner.head() {
            if let Some(oid) = head.target() {
                let _ = revwalk.push(oid);
            }
        }

        let head_oid = self.inner.head().ok().and_then(|h| h.target());

        // Build maps only for local branches (fast)
        let branch_map = self.build_branch_map()?;

        let mut raw_commits = Vec::new();
        for oid_result in revwalk {
            if raw_commits.len() >= max_count {
                break;
            }
            let oid = oid_result?;
            let commit = self.inner.find_commit(oid)?;
            let oid_str = oid.to_string();
            let parent_strs: Vec<String> =
                commit.parent_ids().map(|p| p.to_string()).collect();

            raw_commits.push(RawCommit {
                oid: oid_str,
                parent_oids: parent_strs,
                author_name: commit.author().name().unwrap_or("Unknown").to_string(),
                author_email: commit.author().email().unwrap_or("").to_string(),
                timestamp: commit.time().seconds(),
                summary: commit.summary().unwrap_or("").to_string(),
                branches: branch_map.get(&oid).cloned().unwrap_or_default(),
                is_head: head_oid == Some(oid),
            });
        }

        Ok(assemble_commits(&raw_commits))
    }

    /// Only local branches — fast even for repos with thousands of remote branches.
    fn build_branch_map(&self) -> Result<HashMap<Oid, Vec<String>>, ReviewError> {
        let mut map: HashMap<Oid, Vec<String>> = HashMap::new();
        for branch_result in self.inner.branches(Some(BranchType::Local))? {
            let (branch, _) = branch_result?;
            if let (Some(name), Some(oid)) = (branch.name()?, branch.get().target()) {
                map.entry(oid).or_default().push(name.to_string());
            }
        }
        Ok(map)
    }

    /// Get the full commit message (subject + body) for a given OID.
    pub fn get_commit_message(&self, oid_str: &str) -> Result<String, ReviewError> {
        let oid = Oid::from_str(oid_str)
            .map_err(|e| ReviewError::Other(format!("invalid oid: {e}")))?;
        let commit = self.inner.find_commit(oid)
            .map_err(|e| ReviewError::Other(format!("commit not found: {e}")))?;
        Ok(commit.message().unwrap_or("").to_string())
    }
}
