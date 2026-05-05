mod support;

use review_core::repo::Repo;

#[test]
fn lists_commits_newest_first() {
    let fix = support::GitFixture::new()
        .commit("a.txt", "first")
        .commit("b.txt", "second")
        .commit("c.txt", "third");
    let repo = Repo::open(fix.path_str()).expect("open");
    let commits = repo.list_commits(50).expect("list");
    assert_eq!(commits.len(), 3);
    assert_eq!(commits[0].summary, "add c.txt");
    assert_eq!(commits[2].summary, "add a.txt");
}

#[test]
fn respects_max_count() {
    let fix = support::GitFixture::new()
        .commit("a.txt", "1")
        .commit("b.txt", "2")
        .commit("c.txt", "3");
    let repo = Repo::open(fix.path_str()).expect("open");
    let commits = repo.list_commits(2).expect("list");
    assert_eq!(commits.len(), 2);
}

#[test]
fn head_commit_is_marked() {
    let fix = support::GitFixture::new()
        .commit("a.txt", "first")
        .commit("b.txt", "second");
    let repo = Repo::open(fix.path_str()).expect("open");
    let commits = repo.list_commits(50).expect("list");
    assert!(commits[0].is_head, "newest commit should be HEAD");
    assert!(!commits[1].is_head);
}

#[test]
fn root_commit_has_no_parents() {
    let fix = support::GitFixture::new().commit("a.txt", "root");
    let repo = Repo::open(fix.path_str()).expect("open");
    let commits = repo.list_commits(50).expect("list");
    assert_eq!(commits.len(), 1);
    assert!(commits[0].parent_oids.is_empty());
}

#[test]
fn branch_labels_appear() {
    let fix = support::GitFixture::new()
        .commit("a.txt", "on main")
        .branch("feature")
        .commit("b.txt", "on feature");
    let repo = Repo::open(fix.path_str()).expect("open");
    let commits = repo.list_commits(50).expect("list");
    let head = &commits[0];
    assert!(
        head.branches.contains(&"feature".to_string()),
        "HEAD commit should have 'feature' branch label, got {:?}",
        head.branches,
    );
}

#[test]
fn merge_commit_has_two_parents() {
    let fix = support::GitFixture::new()
        .commit("a.txt", "base")
        .branch("feat")
        .commit("b.txt", "feat work")
        .checkout("master")
        .commit("c.txt", "main work")
        .merge("feat");
    let repo = Repo::open(fix.path_str()).expect("open");
    let commits = repo.list_commits(50).expect("list");
    let merge = &commits[0];
    assert_eq!(
        merge.parent_oids.len(),
        2,
        "merge commit should have 2 parents"
    );
}

#[test]
fn get_commit_message_returns_full_message() {
    let fix = support::GitFixture::new().commit_with_message(
        "a.txt",
        "hello",
        "Subject line\n\nBody paragraph.",
    );
    let repo = Repo::open(fix.path_str()).expect("open");
    let oid = fix.head_oid();
    let msg = repo.get_commit_message(&oid).expect("message");
    assert!(msg.contains("Subject line"));
    assert!(msg.contains("Body paragraph."));
}
