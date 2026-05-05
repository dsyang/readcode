mod support;

use review_core::repo::Repo;
use review_core::types::{CommitRange, FileStatus};

fn find_file<'a>(
    files: &'a [review_core::types::DiffFile],
    path: &str,
) -> &'a review_core::types::DiffFile {
    files.iter().find(|f| f.path == path).unwrap_or_else(|| {
        panic!(
            "file {path} not found in diff; files: {:?}",
            files.iter().map(|f| &f.path).collect::<Vec<_>>()
        )
    })
}

#[test]
fn single_commit_diff_against_parent() {
    let fix = support::GitFixture::new()
        .commit("a.txt", "first")
        .commit("b.txt", "second");
    let repo = Repo::open(fix.path_str()).expect("open");
    let oids = fix.commit_oids(2);
    let range = CommitRange {
        commits: vec![oids[0].clone()], // newest commit
        include_working_tree: false,
    };
    let diff = repo.get_merged_diff(&range).expect("diff");
    assert_eq!(diff.files.len(), 1);
    assert_eq!(diff.files[0].path, "b.txt");
    assert!(matches!(diff.files[0].status, FileStatus::Added));
}

#[test]
fn multiple_commits_diff_from_oldest_parent_to_newest() {
    let fix = support::GitFixture::new()
        .commit("a.txt", "first")
        .commit("b.txt", "second")
        .commit("c.txt", "third");
    let repo = Repo::open(fix.path_str()).expect("open");
    let oids = fix.commit_oids(3); // [newest, mid, oldest]
    let range = CommitRange {
        commits: vec![oids[1].clone(), oids[0].clone()], // mid..newest
        include_working_tree: false,
    };
    let diff = repo.get_merged_diff(&range).expect("diff");
    // Should show b.txt and c.txt (both added relative to a.txt's parent)
    assert!(diff.files.len() >= 2);
}

#[test]
fn working_tree_only_diffs_against_head() {
    let fix = support::GitFixture::new()
        .commit("a.txt", "original")
        .write_workdir("a.txt", "modified");
    let repo = Repo::open(fix.path_str()).expect("open");
    let range = CommitRange {
        commits: vec![],
        include_working_tree: true,
    };
    let diff = repo.get_merged_diff(&range).expect("diff");
    assert_eq!(diff.files.len(), 1);
    assert_eq!(diff.files[0].path, "a.txt");
    assert!(matches!(diff.files[0].status, FileStatus::Modified));
    assert_eq!(diff.head_description, "Working Tree");
}

#[test]
fn commits_plus_working_tree() {
    let fix = support::GitFixture::new()
        .commit("a.txt", "v1")
        .commit("a.txt", "v2")
        .write_workdir("a.txt", "v3");
    let repo = Repo::open(fix.path_str()).expect("open");
    let oids = fix.commit_oids(2);
    let range = CommitRange {
        commits: vec![oids[0].clone()],
        include_working_tree: true,
    };
    let diff = repo.get_merged_diff(&range).expect("diff");
    let f = find_file(&diff.files, "a.txt");
    assert!(matches!(f.status, FileStatus::Modified));
    assert_eq!(diff.head_description, "Working Tree");
}

#[test]
fn root_commit_shows_all_as_added() {
    let fix = support::GitFixture::new().commit("a.txt", "content");
    let repo = Repo::open(fix.path_str()).expect("open");
    let oids = fix.commit_oids(1);
    let range = CommitRange {
        commits: vec![oids[0].clone()],
        include_working_tree: false,
    };
    let diff = repo.get_merged_diff(&range).expect("diff");
    assert_eq!(diff.files.len(), 1);
    assert!(matches!(diff.files[0].status, FileStatus::Added));
    assert!(diff.base_oid.is_none());
}

#[test]
fn added_file_has_additions() {
    let fix = support::GitFixture::new()
        .commit("a.txt", "first")
        .commit("b.txt", "line1\nline2\nline3");
    let repo = Repo::open(fix.path_str()).expect("open");
    let oids = fix.commit_oids(2);
    let range = CommitRange {
        commits: vec![oids[0].clone()],
        include_working_tree: false,
    };
    let diff = repo.get_merged_diff(&range).expect("diff");
    let f = find_file(&diff.files, "b.txt");
    assert!(f.additions >= 3);
    assert_eq!(f.deletions, 0);
}

#[test]
fn deleted_file_detected() {
    let fix = support::GitFixture::new()
        .commit("a.txt", "content")
        .delete_file("a.txt");

    // Stage the deletion and commit
    {
        let mut index = fix.repo.index().expect("index");
        index
            .remove_path(std::path::Path::new("a.txt"))
            .expect("remove");
        index.write().expect("write index");
        let tree_oid = index.write_tree().expect("write tree");
        let tree = fix.repo.find_tree(tree_oid).expect("find tree");
        let sig = git2::Signature::now("Test User", "test@example.com").expect("sig");
        let parent = fix
            .repo
            .head()
            .expect("HEAD")
            .peel_to_commit()
            .expect("commit");
        fix.repo
            .commit(Some("HEAD"), &sig, &sig, "delete a.txt", &tree, &[&parent])
            .expect("commit");
    }

    let repo = Repo::open(fix.path_str()).expect("open");
    let oids = fix.commit_oids(2);
    let range = CommitRange {
        commits: vec![oids[0].clone()],
        include_working_tree: false,
    };
    let diff = repo.get_merged_diff(&range).expect("diff");
    let f = find_file(&diff.files, "a.txt");
    assert!(matches!(f.status, FileStatus::Deleted));
}

#[test]
fn untracked_file_appears_in_working_tree_diff() {
    let fix = support::GitFixture::new()
        .commit("a.txt", "tracked")
        .write_workdir("new.txt", "untracked content");
    let repo = Repo::open(fix.path_str()).expect("open");
    let range = CommitRange {
        commits: vec![],
        include_working_tree: true,
    };
    let diff = repo.get_merged_diff(&range).expect("diff");
    assert!(
        diff.files.iter().any(|f| f.path == "new.txt"),
        "untracked file should appear in working tree diff"
    );
}

#[test]
fn empty_selection_without_working_tree_returns_error() {
    let fix = support::GitFixture::new().commit("a.txt", "content");
    let repo = Repo::open(fix.path_str()).expect("open");
    let range = CommitRange {
        commits: vec![],
        include_working_tree: false,
    };
    let result = repo.get_merged_diff(&range);
    assert!(result.is_err());
}
