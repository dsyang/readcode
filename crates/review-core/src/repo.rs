use git2::{BranchType, Oid, Repository, Sort};
use std::collections::HashMap;
use std::path::Path;

use crate::error::ReviewError;
use crate::types::CommitInfo;

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

    /// List all commits reachable from all branches, in topological order.
    pub fn list_commits(&self, max_count: usize) -> Result<Vec<CommitInfo>, ReviewError> {
        let mut revwalk = self.inner.revwalk()?;
        revwalk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME)?;

        // Push all branches
        for branch in self.inner.branches(None)? {
            let (branch, _) = branch?;
            if let Some(oid) = branch.get().target() {
                revwalk.push(oid)?;
            }
        }

        let head_oid = self.inner.head().ok().and_then(|h| h.target());

        // Build branch/tag maps
        let branch_map = self.build_branch_map()?;
        let tag_map = self.build_tag_map()?;

        let mut commits = Vec::new();
        for oid_result in revwalk {
            if commits.len() >= max_count {
                break;
            }
            let oid = oid_result?;
            let commit = self.inner.find_commit(oid)?;

            let oid_str = oid.to_string();
            let short_oid = oid_str[..7.min(oid_str.len())].to_string();

            let parent_oids: Vec<String> = commit
                .parent_ids()
                .map(|p| p.to_string())
                .collect();

            let branches = branch_map
                .get(&oid)
                .cloned()
                .unwrap_or_default();

            let tags = tag_map
                .get(&oid)
                .cloned()
                .unwrap_or_default();

            commits.push(CommitInfo {
                oid: oid_str,
                short_oid,
                parent_oids,
                author_name: commit.author().name().unwrap_or("Unknown").to_string(),
                author_email: commit.author().email().unwrap_or("").to_string(),
                timestamp: commit.time().seconds(),
                summary: commit.summary().unwrap_or("").to_string(),
                branches,
                tags,
                is_head: head_oid == Some(oid),
            });
        }

        Ok(commits)
    }

    fn build_branch_map(&self) -> Result<HashMap<Oid, Vec<String>>, ReviewError> {
        let mut map: HashMap<Oid, Vec<String>> = HashMap::new();
        for branch_result in self.inner.branches(Some(BranchType::Local))? {
            let (branch, _) = branch_result?;
            if let (Some(name), Some(oid)) = (branch.name()?, branch.get().target()) {
                map.entry(oid).or_default().push(name.to_string());
            }
        }
        for branch_result in self.inner.branches(Some(BranchType::Remote))? {
            let (branch, _) = branch_result?;
            if let (Some(name), Some(oid)) = (branch.name()?, branch.get().target()) {
                map.entry(oid).or_default().push(name.to_string());
            }
        }
        Ok(map)
    }

    fn build_tag_map(&self) -> Result<HashMap<Oid, Vec<String>>, ReviewError> {
        let mut map: HashMap<Oid, Vec<String>> = HashMap::new();
        self.inner.tag_foreach(|oid, name_bytes| {
            if let Ok(name) = std::str::from_utf8(name_bytes) {
                let short_name = name.strip_prefix("refs/tags/").unwrap_or(name);
                // Resolve annotated tags to their commit
                let target_oid = self
                    .inner
                    .find_tag(oid)
                    .ok()
                    .and_then(|tag| Some(tag.target_id()))
                    .unwrap_or(oid);
                map.entry(target_oid)
                    .or_default()
                    .push(short_name.to_string());
            }
            true
        })?;
        Ok(map)
    }
}
