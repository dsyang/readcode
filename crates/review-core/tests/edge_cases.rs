//! Adversarial fixtures: binary files, renames, line-ending quirks, unicode
//! paths, octopus merges, and oversized text. Locks in the libgit2-backed
//! behavior the UI is implicitly relying on.

mod support;

use git2::{Oid, Signature};
use review_core::repo::Repo;
use review_core::types::{CommitRange, FileStatus};
use std::path::Path;

fn range_of(oid: &str) -> CommitRange {
    CommitRange {
        commits: vec![oid.to_string()],
        include_working_tree: false,
    }
}

#[test]
fn binary_file_added_reports_zero_line_stats() {
    // libgit2 refuses to enumerate lines for binary diffs and returns
    // additions=0 / deletions=0 — surface that fact so the UI never assumes
    // a missing diff means "no change."
    let png_header: &[u8] = &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13];
    let fix = support::GitFixture::new().commit_bytes("logo.png", png_header);

    let repo = Repo::open(fix.path_str()).expect("open");
    let head = fix.head_oid();
    let diff = repo.get_merged_diff(&range_of(&head)).expect("diff");

    let entry = diff
        .files
        .iter()
        .find(|f| f.path == "logo.png")
        .expect("png entry");
    assert!(matches!(entry.status, FileStatus::Added));
    assert_eq!(entry.additions, 0);
    assert_eq!(entry.deletions, 0);
}

#[test]
fn binary_file_modified_still_reports_zero_line_stats() {
    let v1: &[u8] = &[0x89, b'P', b'N', b'G', 0x00, 0x01];
    let v2: &[u8] = &[0x89, b'P', b'N', b'G', 0x02, 0x03, 0x04];
    let fix = support::GitFixture::new()
        .commit_bytes("logo.png", v1)
        .commit_bytes("logo.png", v2);

    let repo = Repo::open(fix.path_str()).expect("open");
    let head = fix.head_oid();
    let diff = repo.get_merged_diff(&range_of(&head)).expect("diff");

    let entry = diff
        .files
        .iter()
        .find(|f| f.path == "logo.png")
        .expect("png entry");
    assert!(matches!(entry.status, FileStatus::Modified));
    assert_eq!(entry.additions, 0);
    assert_eq!(entry.deletions, 0);
}

#[test]
fn rename_detection_collapses_add_and_delete_to_a_single_renamed_delta() {
    // Without find_similar(), libgit2 reports a rename as Added(new) +
    // Deleted(old). diff.rs enables rename detection, so the UI sees a
    // single Renamed delta with old_path populated.
    let body = "fn main() {\n    println!(\"hi\");\n}\n";
    let fix = support::GitFixture::new()
        .commit("src/old_name.rs", body)
        .rename_file("src/old_name.rs", "src/new_name.rs");

    let repo = Repo::open(fix.path_str()).expect("open");
    let head = fix.head_oid();
    let diff = repo.get_merged_diff(&range_of(&head)).expect("diff");

    assert_eq!(diff.files.len(), 1, "rename should collapse into one delta");
    let entry = &diff.files[0];
    assert!(matches!(entry.status, FileStatus::Renamed));
    assert_eq!(entry.path, "src/new_name.rs");
    assert_eq!(entry.old_path.as_deref(), Some("src/old_name.rs"));
}

#[test]
fn file_without_trailing_newline_round_trips_through_get_file_at_revision() {
    let raw = "no trailing newline here";
    let fix = support::GitFixture::new().commit("plain.txt", raw);

    let repo = Repo::open(fix.path_str()).expect("open");
    let head = fix.head_oid();
    let content = repo.get_file_at_revision("plain.txt", &head).expect("read");
    assert_eq!(content, raw);
}

#[test]
fn crlf_mixed_with_lf_is_preserved_byte_for_byte() {
    let raw = b"line1\r\nline2\nline3\r\nline4\n";
    let fix = support::GitFixture::new().commit_bytes("mixed.txt", raw);

    let repo = Repo::open(fix.path_str()).expect("open");
    let head = fix.head_oid();
    let content = repo.get_file_at_revision("mixed.txt", &head).expect("read");
    assert_eq!(content.as_bytes(), raw);
}

#[test]
fn unicode_path_cyrillic_appears_in_diff_and_round_trips() {
    // Cyrillic stays as a single normalization across HFS/APFS/Linux, unlike
    // composed-Latin which can flip between NFD and NFC under macOS.
    let path = "тест.txt";
    let fix = support::GitFixture::new().commit(path, "hello, мир");

    let repo = Repo::open(fix.path_str()).expect("open");
    let head = fix.head_oid();
    let diff = repo.get_merged_diff(&range_of(&head)).expect("diff");
    assert!(
        diff.files.iter().any(|f| f.path == path),
        "expected {path} in {:?}",
        diff.files
    );

    let content = repo.get_file_at_revision(path, &head).expect("read");
    assert_eq!(content, "hello, мир");
}

#[test]
fn deleted_then_readded_file_shows_as_modified_over_the_full_range() {
    // Commit foo.txt → delete it → re-add with different content. The diff
    // from the parent of the first commit to HEAD should show the file once
    // (libgit2 collapses the lifecycle into the net effect).
    let fix = support::GitFixture::new()
        .commit("foo.txt", "v1\n")
        .commit("other.txt", "filler so the next commit is not the root");

    // Stage a deletion of foo.txt.
    {
        std::fs::remove_file(fix.path().join("foo.txt")).expect("delete file");
        let mut index = fix.repo.index().expect("index");
        index
            .remove_path(Path::new("foo.txt"))
            .expect("rm from index");
        index.write().expect("write index");
        let tree_oid = index.write_tree().expect("tree");
        let tree = fix.repo.find_tree(tree_oid).expect("find tree");
        let sig = Signature::now("Test User", "test@example.com").expect("sig");
        let parent = fix.repo.head().unwrap().peel_to_commit().unwrap();
        fix.repo
            .commit(Some("HEAD"), &sig, &sig, "remove foo", &tree, &[&parent])
            .expect("commit deletion");
    }

    let fix = fix.commit("foo.txt", "v2\n");

    let repo = Repo::open(fix.path_str()).expect("open");
    let oids = fix.commit_oids(4);
    // oldest to newest: oids[3] is root, oids[0] is HEAD.
    let range = CommitRange {
        commits: vec![oids[2].clone(), oids[1].clone(), oids[0].clone()],
        include_working_tree: false,
    };
    let diff = repo.get_merged_diff(&range).expect("diff");

    let foo = diff
        .files
        .iter()
        .find(|f| f.path == "foo.txt")
        .expect("foo present");
    assert!(matches!(foo.status, FileStatus::Modified));
    let content = repo
        .get_file_at_revision("foo.txt", &fix.head_oid())
        .expect("read");
    assert_eq!(content, "v2\n");
}

#[test]
fn octopus_merge_with_three_parents_is_listed_with_three_parent_oids() {
    // Build root → branchA, branchB, branchC; merge all three into HEAD.
    let fix = support::GitFixture::new().commit("root.txt", "root\n");
    let root_oid = Oid::from_str(&fix.head_oid()).unwrap();

    let fix = fix
        .branch("a")
        .commit("a.txt", "a\n")
        .checkout("master")
        .branch("b")
        .commit("b.txt", "b\n")
        .checkout("master")
        .branch("c")
        .commit("c.txt", "c\n")
        .checkout("master");

    let a_oid = Oid::from_str(
        &fix.repo
            .find_branch("a", git2::BranchType::Local)
            .unwrap()
            .into_reference()
            .target()
            .unwrap()
            .to_string(),
    )
    .unwrap();
    let b_oid = Oid::from_str(
        &fix.repo
            .find_branch("b", git2::BranchType::Local)
            .unwrap()
            .into_reference()
            .target()
            .unwrap()
            .to_string(),
    )
    .unwrap();
    let c_oid = Oid::from_str(
        &fix.repo
            .find_branch("c", git2::BranchType::Local)
            .unwrap()
            .into_reference()
            .target()
            .unwrap()
            .to_string(),
    )
    .unwrap();

    // The current tree is just the root tree; that's fine for testing parent
    // count. (A real octopus would merge the trees too — out of scope here.)
    let fix = fix.commit_with_parents("octopus", &[root_oid, a_oid, b_oid, c_oid]);

    let repo = Repo::open(fix.path_str()).expect("open");
    let commits = repo.list_commits(10).expect("list");
    let head = commits.first().expect("at least one commit");
    assert_eq!(
        head.parent_oids.len(),
        4,
        "octopus has four parents (root + 3 branches)"
    );
}

#[test]
fn very_long_line_is_preserved_intact() {
    let line: String = "a".repeat(10_000);
    let fix = support::GitFixture::new().commit("long.txt", &line);

    let repo = Repo::open(fix.path_str()).expect("open");
    let head = fix.head_oid();
    let content = repo.get_file_at_revision("long.txt", &head).expect("read");
    assert_eq!(content.len(), 10_000);
    assert_eq!(content, line);
}

#[test]
fn one_megabyte_file_round_trips_through_get_file_at_revision() {
    // ASCII fill so there's no UTF-8 ambiguity on the round trip.
    let body: String = "0123456789\n".repeat(100_000); // ~1.1 MB
    let fix = support::GitFixture::new().commit("big.txt", &body);

    let repo = Repo::open(fix.path_str()).expect("open");
    let head = fix.head_oid();
    let content = repo.get_file_at_revision("big.txt", &head).expect("read");
    assert_eq!(content.len(), body.len());
    assert_eq!(&content[..50], &body[..50]);
    assert_eq!(&content[content.len() - 50..], &body[body.len() - 50..]);
}
