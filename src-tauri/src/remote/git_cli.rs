use std::process::Stdio;
use std::time::Duration;

use review_core::dag::{assemble_commits, RawCommit};
use review_core::types::{
    CommitInfo, CommitRange, DiffFile, FileDiffContent, FileStatus, MergedDiff, RepoInfo,
};
use std::collections::HashMap;

use tokio::time::timeout;

const COMMAND_TIMEOUT: Duration = Duration::from_secs(120);

/// Empty tree object id — used as the base when diffing against the root
/// commit (which has no parent).
const EMPTY_TREE: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/// Separator for batching multiple commands in a single SSH invocation.
const BATCH_SEP: &str = "___READCODE_BATCH_SEP___";

/// Remote repository backed by one-shot SSH commands.
pub struct RemoteRepo {
    ssh_host: String,
    repo_path: String,
}

impl RemoteRepo {
    pub async fn open(ssh_host: &str, repo_path: &str) -> Result<(Self, RepoInfo), String> {
        let repo = Self {
            ssh_host: ssh_host.to_string(),
            repo_path: repo_path.to_string(),
        };

        // Validate + get branch in one SSH call.
        let results = repo
            .run_git_batch(&[
                &["rev-parse", "--show-toplevel"],
                &["symbolic-ref", "--short", "HEAD"],
            ])
            .await?;

        let toplevel = results[0].trim().to_string();
        if toplevel.is_empty() {
            return Err(format!("{repo_path} is not a git repository"));
        }

        let current_branch = results
            .get(1)
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        Ok((repo, RepoInfo { workdir: toplevel, current_branch }))
    }

    pub async fn shutdown(self) {}

    /// Stable string identifying this remote repo (for local storage keys).
    pub fn identifier(&self) -> String {
        format!("{}:{}", self.ssh_host, self.repo_path)
    }

    // -----------------------------------------------------------------------
    // SSH transport
    // -----------------------------------------------------------------------

    /// Run a single git command on the remote host.
    async fn run_git(&self, args: &[&str]) -> Result<String, String> {
        self.run_ssh(&self.git_cmd(args)).await
    }

    /// Run multiple git commands in ONE SSH invocation. Individual command
    /// failures produce empty strings rather than aborting the whole batch
    /// (stderr is suppressed per-command).
    async fn run_git_batch(&self, commands: &[&[&str]]) -> Result<Vec<String>, String> {
        if commands.len() == 1 {
            return self.run_git(commands[0]).await.map(|s| vec![s]);
        }
        let parts: Vec<String> = commands.iter().map(|args| self.git_cmd(args)).collect();
        let combined = parts
            .iter()
            .enumerate()
            .map(|(i, cmd)| {
                if i < parts.len() - 1 {
                    format!("{{ {cmd}; }} 2>/dev/null; printf '\\n{BATCH_SEP}\\n'")
                } else {
                    format!("{{ {cmd}; }} 2>/dev/null")
                }
            })
            .collect::<Vec<_>>()
            .join("; ");
        let output = self.run_ssh(&combined).await?;
        let sep_line = format!("\n{BATCH_SEP}\n");
        Ok(output.split(&sep_line).map(|s| s.to_string()).collect())
    }

    /// Build a `git -C <repo> <args...>` command string.
    fn git_cmd(&self, args: &[&str]) -> String {
        let mut cmd = format!("git -C {}", sh_quote(&self.repo_path));
        for a in args {
            cmd.push(' ');
            cmd.push_str(&sh_quote(a));
        }
        cmd
    }

    /// Run an arbitrary command on the remote host.
    async fn run_raw(&self, line: &str) -> Result<String, String> {
        self.run_ssh(line).await
    }

    /// Execute a command string on the remote host via SSH.
    async fn run_ssh(&self, remote_cmd: &str) -> Result<String, String> {
        let login_shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
        let ctl_path = format!("/tmp/readcode-ssh-{}", &self.ssh_host);
        let ssh_invocation = format!(
            "ssh -T -o ControlMaster=auto -o ControlPath={} -o ControlPersist=3600 -o ServerAliveInterval=60 {} {}",
            sh_quote(&ctl_path),
            &self.ssh_host,
            sh_quote(remote_cmd),
        );

        let child = tokio::process::Command::new(&login_shell)
            .arg("-l")
            .arg("-c")
            .arg(&ssh_invocation)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| format!("failed to spawn ssh: {e}"))?;

        let result = timeout(COMMAND_TIMEOUT, child.wait_with_output())
            .await
            .map_err(|_| format!("ssh command timed out after {}s", COMMAND_TIMEOUT.as_secs()))?
            .map_err(|e| format!("ssh command failed: {e}"))?;

        let stdout = String::from_utf8_lossy(&result.stdout).into_owned();
        let stderr = String::from_utf8_lossy(&result.stderr).into_owned();

        if result.status.success() {
            Ok(stdout)
        } else {
            let code = result.status.code().unwrap_or(-1);
            if stderr.trim().is_empty() {
                Err(format!("remote command failed (exit {code}):\n{stdout}"))
            } else {
                Err(format!(
                    "remote command failed (exit {code}):\n{stdout}\nstderr:\n{stderr}"
                ))
            }
        }
    }

    // -----------------------------------------------------------------------
    // Git operations
    // -----------------------------------------------------------------------

    pub async fn list_commits(&self, max_count: usize) -> Result<Vec<CommitInfo>, String> {
        let fmt = "%H%x01%P%x01%an%x01%ae%x01%at%x01%D%x01%s";
        let max_arg = format!("-n{max_count}");
        let format_arg = format!("--format={fmt}");

        // log + HEAD resolution in one SSH call.
        let results = self
            .run_git_batch(&[
                &["log", "--topo-order", "--branches", &max_arg, &format_arg],
                &["rev-parse", "HEAD"],
            ])
            .await?;

        let log = &results[0];
        let head_oid = results.get(1).map(|s| s.trim().to_string()).filter(|s| !s.is_empty());

        let mut raw = Vec::new();
        for line in log.lines() {
            if line.is_empty() {
                continue;
            }
            let parts: Vec<&str> = line.splitn(7, '\x01').collect();
            if parts.len() < 7 {
                continue;
            }
            let oid = parts[0].to_string();
            let parents: Vec<String> = if parts[1].is_empty() {
                Vec::new()
            } else {
                parts[1].split(' ').map(|s| s.to_string()).collect()
            };
            let timestamp: i64 = parts[4].parse().unwrap_or(0);
            let branches = parse_decorate(parts[5]);
            let is_head = head_oid.as_deref() == Some(oid.as_str());

            raw.push(RawCommit {
                oid,
                parent_oids: parents,
                author_name: parts[2].to_string(),
                author_email: parts[3].to_string(),
                timestamp,
                summary: parts[6].to_string(),
                branches,
                is_head,
            });
        }

        Ok(assemble_commits(&raw))
    }

    pub async fn get_merged_diff(&self, range: &CommitRange) -> Result<MergedDiff, String> {
        if range.commits.is_empty() && !range.include_working_tree {
            return Err("no commits selected".to_string());
        }

        let (base_ref, head_arg, head_description): (String, Option<String>, String) =
            if range.commits.is_empty() {
                ("HEAD".to_string(), None, "Working Tree".to_string())
            } else if range.include_working_tree {
                (format!("{}^", range.commits[0]), None, "Working Tree".to_string())
            } else {
                let newest = range.commits.last().unwrap().clone();
                let short = newest[..7.min(newest.len())].to_string();
                (format!("{}^", range.commits[0]), Some(newest), short)
            };

        // Resolve the base to a concrete OID (handles root commits that
        // have no parent by falling back to the empty tree), then run
        // numstat + name-status — all in one SSH call.
        let batch: Vec<Vec<&str>> = match head_arg.as_deref() {
            Some(h) => vec![
                vec!["rev-parse", &base_ref],
                vec!["diff", "--numstat", &base_ref, h],
                vec!["diff", "--name-status", &base_ref, h],
            ],
            None => vec![
                vec!["rev-parse", &base_ref],
                vec!["diff", "--numstat", &base_ref],
                vec!["diff", "--name-status", &base_ref],
            ],
        };
        let batch_refs: Vec<&[&str]> = batch.iter().map(|v| v.as_slice()).collect();
        let results = self.run_git_batch(&batch_refs).await?;

        let base = {
            let resolved = results[0].trim();
            if resolved.is_empty() { EMPTY_TREE.to_string() } else { resolved.to_string() }
        };
        let numstat = &results[1];
        let name_status = &results[2];

        let mut by_path: HashMap<String, DiffFile> = HashMap::new();
        for line in numstat.lines() {
            let cols: Vec<&str> = line.splitn(3, '\t').collect();
            if cols.len() < 3 {
                continue;
            }
            let additions: u32 = cols[0].parse().unwrap_or(0);
            let deletions: u32 = cols[1].parse().unwrap_or(0);
            let path = cols[2].to_string();
            by_path.insert(
                path.clone(),
                DiffFile {
                    path,
                    status: FileStatus::Modified,
                    old_path: None,
                    additions,
                    deletions,
                },
            );
        }

        for line in name_status.lines() {
            let cols: Vec<&str> = line.split('\t').collect();
            if cols.len() < 2 {
                continue;
            }
            let letter = cols[0];
            let (status, path, old_path) = if letter.starts_with('R') && cols.len() >= 3 {
                (FileStatus::Renamed, cols[2].to_string(), Some(cols[1].to_string()))
            } else if letter.starts_with('C') && cols.len() >= 3 {
                (FileStatus::Copied, cols[2].to_string(), Some(cols[1].to_string()))
            } else {
                let s = match letter.chars().next().unwrap_or('M') {
                    'A' => FileStatus::Added,
                    'D' => FileStatus::Deleted,
                    _ => FileStatus::Modified,
                };
                (s, cols[1].to_string(), None)
            };
            let entry = by_path.entry(path.clone()).or_insert_with(|| DiffFile {
                path: path.clone(),
                status: FileStatus::Modified,
                old_path: None,
                additions: 0,
                deletions: 0,
            });
            entry.status = status;
            entry.old_path = old_path;
        }

        let mut files: Vec<DiffFile> = by_path.into_values().collect();
        files.sort_by(|a, b| a.path.cmp(&b.path));

        Ok(MergedDiff {
            files,
            base_oid: Some(base),
            head_description,
        })
    }

    pub async fn get_commit_message(&self, oid: &str) -> Result<String, String> {
        self.run_git(&["log", "-1", "--format=%B", oid]).await
    }

    pub async fn get_file_at_revision(&self, path: &str, rev: &str) -> Result<String, String> {
        if rev == "WORKING_TREE" {
            let full = format!("{}/{}", self.repo_path, path);
            self.run_raw(&format!("cat -- {}", sh_quote(&full))).await
        } else {
            self.run_git(&["show", &format!("{rev}:{path}")]).await
        }
    }

    pub async fn get_file_diff_content(
        &self,
        path: &str,
        range: &CommitRange,
    ) -> Result<FileDiffContent, String> {
        // Compute base and new revisions without a separate SSH call.
        // Using `commit^` directly — git resolves it. If the commit is
        // a root (no parent), `git show` fails and we default to empty.
        let base_rev = if range.commits.is_empty() {
            "HEAD".to_string()
        } else {
            format!("{}^", range.commits[0])
        };

        let new_rev = if range.include_working_tree {
            "WORKING_TREE".to_string()
        } else {
            range.commits.last().cloned().unwrap_or_default()
        };

        // Fetch old and new content in parallel.
        let (old_result, new_result) = tokio::join!(
            self.get_file_at_revision(path, &base_rev),
            self.get_file_at_revision(path, &new_rev),
        );

        let old_content = old_result.unwrap_or_default();
        let new_content = new_result.unwrap_or_default();

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
}

/// POSIX shell single-quote: wrap in '...' and escape inner quotes as '\''.
fn sh_quote(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('\'');
    for c in s.chars() {
        if c == '\'' {
            out.push_str("'\\''");
        } else {
            out.push(c);
        }
    }
    out.push('\'');
    out
}

/// Extract local branch names from git log's `%D` decorate field.
fn parse_decorate(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    for part in s.split(',') {
        let p = part.trim();
        if p.is_empty() {
            continue;
        }
        let p = p.strip_prefix("HEAD -> ").unwrap_or(p);
        if p == "HEAD" || p.starts_with("tag: ") || p.contains('/') {
            continue;
        }
        out.push(p.to_string());
    }
    out
}
