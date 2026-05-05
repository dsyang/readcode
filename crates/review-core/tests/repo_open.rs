mod support;

use review_core::repo::Repo;

#[test]
fn open_discovers_git_dir() {
    let fix = support::GitFixture::new().commit("a.txt", "hello");
    let repo = Repo::open(fix.path_str()).expect("open");
    let info = repo.info();
    assert!(!info.workdir.is_empty());
}

#[test]
fn open_reports_current_branch() {
    let fix = support::GitFixture::new().commit("a.txt", "hello");
    let repo = Repo::open(fix.path_str()).expect("open");
    let info = repo.info();
    // After git init + first commit, branch is typically "main" or "master"
    assert!(info.current_branch.is_some());
}

#[test]
fn open_non_repo_fails() {
    let dir = tempfile::tempdir().expect("tmpdir");
    let result = Repo::open(dir.path().to_str().unwrap());
    assert!(result.is_err());
}

#[test]
fn open_subdirectory_discovers_parent() {
    let fix = support::GitFixture::new().commit("dir/file.txt", "content");
    let subdir = fix.path().join("dir");
    let repo = Repo::open(subdir.to_str().unwrap()).expect("open from subdir");
    let info = repo.info();
    assert!(!info.workdir.is_empty());
}
