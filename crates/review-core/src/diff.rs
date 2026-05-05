use git2::{Diff, DiffOptions, Oid};

use crate::error::ReviewError;
use crate::repo::Repo;
use crate::types::{CommitRange, DiffFile, FileDiffContent, FileStatus, MergedDiff};

impl Repo {
    /// Compute a merged diff for a commit range.
    ///
    /// - Commits only: diff from parent-of-oldest to newest
    /// - Commits + working tree: diff from parent-of-oldest to working tree
    pub fn get_merged_diff(&self, range: &CommitRange) -> Result<MergedDiff, ReviewError> {
        if range.commits.is_empty() && !range.include_working_tree {
            return Err(ReviewError::NoCommitsSelected);
        }

        let repo = self.inner();

        // Find the base: parent of the oldest selected commit
        let base_tree = if !range.commits.is_empty() {
            let oldest_oid = Oid::from_str(&range.commits[0])
                .map_err(|_| ReviewError::CommitNotFound(range.commits[0].clone()))?;
            let oldest_commit = repo
                .find_commit(oldest_oid)
                .map_err(|_| ReviewError::CommitNotFound(range.commits[0].clone()))?;

            // Use the first parent as the base
            if oldest_commit.parent_count() > 0 {
                Some(oldest_commit.parent(0)?.tree()?)
            } else {
                // Root commit — diff against empty tree
                None
            }
        } else {
            // Only working tree selected — diff HEAD against working tree
            let head = repo.head()?.peel_to_commit()?;
            Some(head.tree()?)
        };

        let (diff, head_description) = if range.include_working_tree {
            // Diff from base to working tree (includes index + untracked files)
            let mut opts = DiffOptions::new();
            opts.include_untracked(true);
            opts.recurse_untracked_dirs(true);
            opts.show_untracked_content(true);
            let diff = match &base_tree {
                Some(tree) => repo.diff_tree_to_workdir_with_index(Some(tree), Some(&mut opts))?,
                None => repo.diff_tree_to_workdir_with_index(None, Some(&mut opts))?,
            };
            (diff, "Working Tree".to_string())
        } else {
            // Diff from base to newest commit
            let newest_oid = Oid::from_str(range.commits.last().unwrap())
                .map_err(|_| ReviewError::CommitNotFound(range.commits.last().unwrap().clone()))?;
            let newest_commit = repo
                .find_commit(newest_oid)
                .map_err(|_| ReviewError::CommitNotFound(range.commits.last().unwrap().clone()))?;
            let newest_tree = newest_commit.tree()?;

            let mut opts = DiffOptions::new();
            let diff =
                repo.diff_tree_to_tree(base_tree.as_ref(), Some(&newest_tree), Some(&mut opts))?;
            (diff, newest_oid.to_string()[..7].to_string())
        };

        let files = extract_diff_files(&diff)?;
        let base_oid = base_tree.map(|t| t.id().to_string());

        Ok(MergedDiff {
            files,
            base_oid,
            head_description,
        })
    }

    /// Get full file contents for both sides of a diff for a specific file.
    pub fn get_file_diff_content(
        &self,
        path: &str,
        range: &CommitRange,
    ) -> Result<FileDiffContent, ReviewError> {
        let repo = self.inner();

        // Determine base revision (parent of oldest commit)
        let base_oid = if !range.commits.is_empty() {
            let oldest_oid = Oid::from_str(&range.commits[0])
                .map_err(|_| ReviewError::CommitNotFound(range.commits[0].clone()))?;
            let oldest_commit = repo
                .find_commit(oldest_oid)
                .map_err(|_| ReviewError::CommitNotFound(range.commits[0].clone()))?;
            if oldest_commit.parent_count() > 0 {
                Some(oldest_commit.parent(0)?.id())
            } else {
                None
            }
        } else {
            Some(repo.head()?.peel_to_commit()?.id())
        };

        // Get old content
        let old_content = if let Some(oid) = base_oid {
            self.get_file_at_oid(path, oid).unwrap_or_default()
        } else {
            String::new()
        };

        // Get new content
        let new_content = if range.include_working_tree {
            // Read from working directory
            self.get_file_from_workdir(path).unwrap_or_default()
        } else if let Some(newest) = range.commits.last() {
            let oid =
                Oid::from_str(newest).map_err(|_| ReviewError::CommitNotFound(newest.clone()))?;
            self.get_file_at_oid(path, oid).unwrap_or_default()
        } else {
            String::new()
        };

        // Determine status
        let status = if old_content.is_empty() && !new_content.is_empty() {
            FileStatus::Added
        } else if !old_content.is_empty() && new_content.is_empty() {
            FileStatus::Deleted
        } else {
            FileStatus::Modified
        };

        Ok(FileDiffContent {
            path: path.to_string(),
            old_content,
            new_content,
            status,
        })
    }

    /// Read file content at a specific commit OID.
    pub fn get_file_at_oid(&self, path: &str, oid: Oid) -> Result<String, ReviewError> {
        let repo = self.inner();
        let commit = repo
            .find_commit(oid)
            .map_err(|_| ReviewError::CommitNotFound(oid.to_string()))?;
        let tree = commit.tree()?;
        let entry =
            tree.get_path(std::path::Path::new(path))
                .map_err(|_| ReviewError::FileNotFound {
                    path: path.to_string(),
                    rev: oid.to_string(),
                })?;
        let blob = repo.find_blob(entry.id())?;
        Ok(String::from_utf8_lossy(blob.content()).to_string())
    }

    /// Read file content from the working directory.
    pub fn get_file_from_workdir(&self, path: &str) -> Result<String, ReviewError> {
        let workdir = self.workdir().ok_or_else(|| {
            ReviewError::Other("Bare repository has no working directory".to_string())
        })?;
        let full_path = workdir.join(path);
        std::fs::read_to_string(&full_path).map_err(|_| ReviewError::FileNotFound {
            path: path.to_string(),
            rev: "WORKING_TREE".to_string(),
        })
    }

    /// Get file content at a named revision (commit hash or "WORKING_TREE").
    pub fn get_file_at_revision(&self, path: &str, rev: &str) -> Result<String, ReviewError> {
        if rev == "WORKING_TREE" {
            self.get_file_from_workdir(path)
        } else {
            let oid =
                Oid::from_str(rev).map_err(|_| ReviewError::CommitNotFound(rev.to_string()))?;
            self.get_file_at_oid(path, oid)
        }
    }
}

fn extract_diff_files(diff: &Diff) -> Result<Vec<DiffFile>, ReviewError> {
    let stats = diff.stats()?;
    let _ = stats; // We compute per-file stats below

    let mut files = Vec::new();
    let num_deltas = diff.deltas().len();

    for i in 0..num_deltas {
        let delta = diff.get_delta(i).unwrap();
        let new_file = delta.new_file();
        let old_file = delta.old_file();

        let path = new_file
            .path()
            .or_else(|| old_file.path())
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();

        let old_path = if delta.status() == git2::Delta::Renamed {
            old_file.path().map(|p| p.to_string_lossy().to_string())
        } else {
            None
        };

        let status = match delta.status() {
            git2::Delta::Added => FileStatus::Added,
            git2::Delta::Deleted => FileStatus::Deleted,
            git2::Delta::Modified => FileStatus::Modified,
            git2::Delta::Renamed => FileStatus::Renamed,
            git2::Delta::Copied => FileStatus::Copied,
            _ => FileStatus::Modified,
        };

        // Count additions/deletions from the patch
        let mut additions = 0u32;
        let mut deletions = 0u32;
        if let Ok(Some(patch)) = git2::Patch::from_diff(diff, i) {
            let (_, adds, dels) = patch.line_stats()?;
            additions = adds as u32;
            deletions = dels as u32;
        }

        files.push(DiffFile {
            path,
            status,
            old_path,
            additions,
            deletions,
        });
    }

    Ok(files)
}
