use git2::{Repository, RepositoryInitOptions, Signature};
use std::path::Path;
use tempfile::TempDir;

#[allow(dead_code)]
pub struct GitFixture {
    pub dir: TempDir,
    pub repo: Repository,
}

#[allow(dead_code)]
impl GitFixture {
    pub fn new() -> Self {
        let dir = TempDir::new().expect("create temp dir");
        let mut opts = RepositoryInitOptions::new();
        opts.initial_head("master");
        let repo = Repository::init_opts(dir.path(), &opts).expect("git init");

        {
            let mut config = repo.config().expect("get config");
            config
                .set_str("user.name", "Test User")
                .expect("set user.name");
            config
                .set_str("user.email", "test@example.com")
                .expect("set user.email");
        }

        Self { dir, repo }
    }

    pub fn path(&self) -> &Path {
        self.dir.path()
    }

    pub fn path_str(&self) -> &str {
        self.dir.path().to_str().expect("valid utf-8 path")
    }

    pub fn commit(self, filename: &str, content: &str) -> Self {
        self.commit_with_message(filename, content, &format!("add {filename}"))
    }

    pub fn commit_with_message(self, filename: &str, content: &str, message: &str) -> Self {
        self.commit_bytes_with_message(filename, content.as_bytes(), message)
    }

    /// Commit a file with raw bytes — for binary content, CRLF line endings,
    /// no-trailing-newline cases, BOMs, or anything else where stringly typed
    /// `commit()` would be lossy.
    pub fn commit_bytes(self, filename: &str, content: &[u8]) -> Self {
        let msg = format!("add {filename}");
        self.commit_bytes_with_message(filename, content, &msg)
    }

    pub fn commit_bytes_with_message(self, filename: &str, content: &[u8], message: &str) -> Self {
        let file_path = self.dir.path().join(filename);
        if let Some(parent) = file_path.parent() {
            std::fs::create_dir_all(parent).expect("create parent dirs");
        }
        std::fs::write(&file_path, content).expect("write file");

        let mut index = self.repo.index().expect("get index");
        index.add_path(Path::new(filename)).expect("add to index");
        index.write().expect("write index");

        let tree_oid = index.write_tree().expect("write tree");

        {
            let tree = self.repo.find_tree(tree_oid).expect("find tree");
            let sig = Signature::now("Test User", "test@example.com").expect("signature");
            let parent = self.repo.head().ok().and_then(|h| h.peel_to_commit().ok());
            let parents: Vec<&git2::Commit> = parent.iter().collect();
            self.repo
                .commit(Some("HEAD"), &sig, &sig, message, &tree, &parents)
                .expect("commit");
        }

        self
    }

    /// Rename a tracked file and commit the rename. The new file content is
    /// preserved verbatim so libgit2's similarity-based rename detection
    /// triggers on identical bytes.
    pub fn rename_file(self, from: &str, to: &str) -> Self {
        let from_path = self.dir.path().join(from);
        let to_path = self.dir.path().join(to);
        if let Some(parent) = to_path.parent() {
            std::fs::create_dir_all(parent).expect("create parent dirs");
        }
        std::fs::rename(&from_path, &to_path).expect("rename file");

        let mut index = self.repo.index().expect("get index");
        index
            .remove_path(Path::new(from))
            .expect("remove from index");
        index.add_path(Path::new(to)).expect("add to index");
        index.write().expect("write index");

        let tree_oid = index.write_tree().expect("write tree");

        {
            let tree = self.repo.find_tree(tree_oid).expect("find tree");
            let sig = Signature::now("Test User", "test@example.com").expect("signature");
            let parent = self
                .repo
                .head()
                .ok()
                .and_then(|h| h.peel_to_commit().ok())
                .expect("HEAD has a commit");
            self.repo
                .commit(
                    Some("HEAD"),
                    &sig,
                    &sig,
                    &format!("rename {from} -> {to}"),
                    &tree,
                    &[&parent],
                )
                .expect("commit");
        }

        self
    }

    /// Create a commit with multiple parents (for octopus-merge fixtures).
    /// The current index/tree state becomes the commit's tree; pass parent
    /// OIDs in the order you want them recorded.
    pub fn commit_with_parents(self, message: &str, parent_oids: &[git2::Oid]) -> Self {
        let mut index = self.repo.index().expect("get index");
        let tree_oid = index.write_tree().expect("write tree");

        {
            let tree = self.repo.find_tree(tree_oid).expect("find tree");
            let sig = Signature::now("Test User", "test@example.com").expect("signature");
            let parents: Vec<git2::Commit> = parent_oids
                .iter()
                .map(|oid| self.repo.find_commit(*oid).expect("find parent"))
                .collect();
            let parent_refs: Vec<&git2::Commit> = parents.iter().collect();
            self.repo
                .commit(Some("HEAD"), &sig, &sig, message, &tree, &parent_refs)
                .expect("commit");
        }

        self
    }

    pub fn branch(self, name: &str) -> Self {
        {
            let head = self
                .repo
                .head()
                .expect("HEAD")
                .peel_to_commit()
                .expect("commit");
            self.repo.branch(name, &head, false).expect("create branch");
        }
        self.repo
            .set_head(&format!("refs/heads/{name}"))
            .expect("set HEAD");
        self.repo
            .checkout_head(Some(git2::build::CheckoutBuilder::new().force()))
            .expect("checkout");
        self
    }

    pub fn checkout(self, name: &str) -> Self {
        self.repo
            .set_head(&format!("refs/heads/{name}"))
            .expect("set HEAD");
        self.repo
            .checkout_head(Some(git2::build::CheckoutBuilder::new().force()))
            .expect("checkout");
        self
    }

    pub fn merge(self, branch_name: &str) -> Self {
        let merge_tree_oid;
        {
            let their_ref = self
                .repo
                .find_branch(branch_name, git2::BranchType::Local)
                .expect("find branch")
                .into_reference();
            let their_commit = their_ref.peel_to_commit().expect("peel to commit");
            let our_commit = self
                .repo
                .head()
                .expect("HEAD")
                .peel_to_commit()
                .expect("commit");

            let ancestor = self
                .repo
                .find_commit(
                    self.repo
                        .merge_base(our_commit.id(), their_commit.id())
                        .expect("merge base"),
                )
                .expect("ancestor");

            let mut merge_index = self
                .repo
                .merge_trees(
                    &ancestor.tree().expect("tree"),
                    &our_commit.tree().expect("tree"),
                    &their_commit.tree().expect("tree"),
                    None,
                )
                .expect("merge trees");

            merge_tree_oid = merge_index
                .write_tree_to(&self.repo)
                .expect("write merge tree");

            let tree = self.repo.find_tree(merge_tree_oid).expect("find tree");
            let sig = Signature::now("Test User", "test@example.com").expect("signature");

            self.repo
                .commit(
                    Some("HEAD"),
                    &sig,
                    &sig,
                    &format!("Merge branch '{branch_name}'"),
                    &tree,
                    &[&our_commit, &their_commit],
                )
                .expect("merge commit");
        }

        self
    }

    pub fn write_workdir(self, filename: &str, content: &str) -> Self {
        let file_path = self.dir.path().join(filename);
        if let Some(parent) = file_path.parent() {
            std::fs::create_dir_all(parent).expect("create parent dirs");
        }
        std::fs::write(file_path, content).expect("write file");
        self
    }

    pub fn delete_file(self, filename: &str) -> Self {
        let file_path = self.dir.path().join(filename);
        std::fs::remove_file(file_path).expect("delete file");
        self
    }

    pub fn head_oid(&self) -> String {
        self.repo
            .head()
            .expect("HEAD")
            .target()
            .expect("target")
            .to_string()
    }

    pub fn commit_oids(&self, count: usize) -> Vec<String> {
        let mut revwalk = self.repo.revwalk().expect("revwalk");
        revwalk
            .set_sorting(git2::Sort::TOPOLOGICAL | git2::Sort::TIME)
            .expect("set sorting");
        revwalk.push_head().expect("push HEAD");

        revwalk
            .take(count)
            .map(|oid| oid.expect("oid").to_string())
            .collect()
    }
}
