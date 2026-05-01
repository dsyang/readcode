mod support;

use review_core::repo::Repo;
use review_core::types::{CommitRange, FileStatus};

#[test]
fn added_file_has_empty_old_content() {
    let fix = support::GitFixture::new()
        .commit("a.txt", "first")
        .commit("b.txt", "new file content");
    let repo = Repo::open(fix.path_str()).expect("open");
    let oids = fix.commit_oids(2);
    let range = CommitRange {
        commits: vec![oids[0].clone()],
        include_working_tree: false,
    };
    let fdc = repo.get_file_diff_content("b.txt", &range).expect("diff content");
    assert_eq!(fdc.path, "b.txt");
    assert!(fdc.old_content.is_empty());
    assert_eq!(fdc.new_content, "new file content");
    assert!(matches!(fdc.status, FileStatus::Added));
}

#[test]
fn modified_file_has_both_contents() {
    let fix = support::GitFixture::new()
        .commit("a.txt", "version 1")
        .commit("a.txt", "version 2");
    let repo = Repo::open(fix.path_str()).expect("open");
    let oids = fix.commit_oids(2);
    let range = CommitRange {
        commits: vec![oids[0].clone()],
        include_working_tree: false,
    };
    let fdc = repo.get_file_diff_content("a.txt", &range).expect("diff content");
    assert_eq!(fdc.old_content, "version 1");
    assert_eq!(fdc.new_content, "version 2");
    assert!(matches!(fdc.status, FileStatus::Modified));
}

#[test]
fn working_tree_content_from_disk() {
    let fix = support::GitFixture::new()
        .commit("a.txt", "committed")
        .write_workdir("a.txt", "on disk now");
    let repo = Repo::open(fix.path_str()).expect("open");
    let range = CommitRange {
        commits: vec![],
        include_working_tree: true,
    };
    let fdc = repo.get_file_diff_content("a.txt", &range).expect("diff content");
    assert_eq!(fdc.old_content, "committed");
    assert_eq!(fdc.new_content, "on disk now");
}

#[test]
fn get_file_at_revision_returns_content() {
    let fix = support::GitFixture::new()
        .commit("a.txt", "hello world");
    let repo = Repo::open(fix.path_str()).expect("open");
    let oid = fix.head_oid();
    let content = repo.get_file_at_revision("a.txt", &oid).expect("at revision");
    assert_eq!(content, "hello world");
}

#[test]
fn get_file_at_revision_working_tree() {
    let fix = support::GitFixture::new()
        .commit("a.txt", "committed")
        .write_workdir("a.txt", "workdir version");
    let repo = Repo::open(fix.path_str()).expect("open");
    let content = repo.get_file_at_revision("a.txt", "WORKING_TREE").expect("working tree");
    assert_eq!(content, "workdir version");
}

#[test]
fn get_file_at_revision_nonexistent_file_fails() {
    let fix = support::GitFixture::new().commit("a.txt", "exists");
    let repo = Repo::open(fix.path_str()).expect("open");
    let oid = fix.head_oid();
    let result = repo.get_file_at_revision("nope.txt", &oid);
    assert!(result.is_err());
}

#[test]
fn multiple_commits_shows_net_diff() {
    let fix = support::GitFixture::new()
        .commit("a.txt", "v1")
        .commit("a.txt", "v2")
        .commit("a.txt", "v3");
    let repo = Repo::open(fix.path_str()).expect("open");
    let oids = fix.commit_oids(3);
    // Range: from second-oldest to newest (spans two commits)
    let range = CommitRange {
        commits: vec![oids[1].clone(), oids[0].clone()],
        include_working_tree: false,
    };
    let fdc = repo.get_file_diff_content("a.txt", &range).expect("diff content");
    assert_eq!(fdc.old_content, "v1");
    assert_eq!(fdc.new_content, "v3");
}
