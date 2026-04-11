use git2::{BranchType, Oid, Repository, Sort};
use std::collections::HashMap;
use std::path::Path;

use crate::error::ReviewError;
use crate::types::{CommitInfo, DagEdge, RepoInfo};

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
        let branch_map = self.build_branch_map()?;
        let tag_map = self.build_tag_map()?;

        // Collect raw commit data first
        struct RawCommit {
            oid: Oid,
            oid_str: String,
            short_oid: String,
            parent_oids: Vec<Oid>,
            parent_strs: Vec<String>,
            author_name: String,
            author_email: String,
            timestamp: i64,
            summary: String,
            branches: Vec<String>,
            tags: Vec<String>,
            is_head: bool,
        }

        let mut raw_commits = Vec::new();
        for oid_result in revwalk {
            if raw_commits.len() >= max_count {
                break;
            }
            let oid = oid_result?;
            let commit = self.inner.find_commit(oid)?;
            let oid_str = oid.to_string();
            let short_oid = oid_str[..7.min(oid_str.len())].to_string();
            let parent_oids: Vec<Oid> = commit.parent_ids().collect();
            let parent_strs: Vec<String> = parent_oids.iter().map(|p| p.to_string()).collect();

            raw_commits.push(RawCommit {
                oid,
                oid_str,
                short_oid,
                parent_oids,
                parent_strs,
                author_name: commit.author().name().unwrap_or("Unknown").to_string(),
                author_email: commit.author().email().unwrap_or("").to_string(),
                timestamp: commit.time().seconds(),
                summary: commit.summary().unwrap_or("").to_string(),
                branches: branch_map.get(&oid).cloned().unwrap_or_default(),
                tags: tag_map.get(&oid).cloned().unwrap_or_default(),
                is_head: head_oid == Some(oid),
            });
        }

        // DAG lane assignment (straight-branch variant)
        // lanes[i] = Some(oid) means lane i is reserved for a commit chain ending at oid
        let mut lanes: Vec<Option<Oid>> = Vec::new();
        // Map from OID to assigned lane
        let mut oid_to_lane: HashMap<Oid, usize> = HashMap::new();
        // Map from OID to color index
        let mut oid_to_color: HashMap<Oid, usize> = HashMap::new();
        let mut next_color: usize = 0;

        let mut commits = Vec::new();

        for raw in &raw_commits {
            // Find lane for this commit
            let my_lane = if let Some(&lane) = oid_to_lane.get(&raw.oid) {
                lane
            } else {
                // New branch head — find an empty lane or add one
                let lane = lanes
                    .iter()
                    .position(|l| l.is_none())
                    .unwrap_or_else(|| {
                        lanes.push(None);
                        lanes.len() - 1
                    });
                lanes[lane] = Some(raw.oid);
                oid_to_color.insert(raw.oid, next_color);
                next_color += 1;
                lane
            };

            let my_color = *oid_to_color.get(&raw.oid).unwrap_or(&0);

            // Build edges and update lanes for parents
            let mut edges = Vec::new();

            // Free this commit's lane
            lanes[my_lane] = None;

            for (i, parent_oid) in raw.parent_oids.iter().enumerate() {
                let parent_lane = if let Some(&existing_lane) = oid_to_lane.get(parent_oid) {
                    // Parent already has a lane (merge commit case)
                    existing_lane
                } else if i == 0 {
                    // First parent continues on the same lane
                    lanes[my_lane] = Some(*parent_oid);
                    oid_to_lane.insert(*parent_oid, my_lane);
                    oid_to_color.insert(*parent_oid, my_color);
                    my_lane
                } else {
                    // Additional parents get a new lane
                    let lane = lanes
                        .iter()
                        .position(|l| l.is_none())
                        .unwrap_or_else(|| {
                            lanes.push(None);
                            lanes.len() - 1
                        });
                    lanes[lane] = Some(*parent_oid);
                    oid_to_lane.insert(*parent_oid, lane);
                    let color = next_color;
                    next_color += 1;
                    oid_to_color.insert(*parent_oid, color);
                    lane
                };

                let edge_color = if i == 0 {
                    my_color
                } else {
                    *oid_to_color.get(parent_oid).unwrap_or(&0)
                };

                edges.push(DagEdge {
                    from_lane: my_lane,
                    to_lane: parent_lane,
                    color: edge_color,
                });
            }

            // Trim trailing empty lanes
            while lanes.last() == Some(&None) {
                lanes.pop();
            }

            commits.push(CommitInfo {
                oid: raw.oid_str.clone(),
                short_oid: raw.short_oid.clone(),
                parent_oids: raw.parent_strs.clone(),
                author_name: raw.author_name.clone(),
                author_email: raw.author_email.clone(),
                timestamp: raw.timestamp,
                summary: raw.summary.clone(),
                branches: raw.branches.clone(),
                tags: raw.tags.clone(),
                is_head: raw.is_head,
                lane: my_lane,
                edges,
                lane_count: lanes.len().max(1),
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
                let target_oid = self
                    .inner
                    .find_tag(oid)
                    .ok()
                    .map(|tag| tag.target_id())
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
