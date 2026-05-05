use review_core::review::*;

#[test]
fn full_lifecycle() {
    let storage = tempfile::tempdir().expect("tmpdir");

    // Create
    let mut session = ReviewSession::new(
        "/tmp/repo".to_string(),
        "local".to_string(),
        Some("main".to_string()),
        Some("aaa".to_string()),
        "bbb".to_string(),
        vec!["aaa".to_string(), "bbb".to_string()],
    );
    assert_eq!(session.version, "1.0");

    // Save
    let path = session.save(storage.path()).expect("save");
    assert!(path.exists());
    assert!(path.to_str().unwrap().contains(&session.session.id));

    // Add comment
    let comment_id = session.add_comment(
        "src/main.rs".to_string(),
        LineRange {
            side: DiffSide::New,
            start: 10,
            end: 15,
        },
        "needs refactoring".to_string(),
        CommentType::Issue,
        Severity::Warning,
        CommentContext {
            before: "fn main() {".to_string(),
            content: "  todo!()".to_string(),
            after: "}".to_string(),
        },
    );
    session.save(storage.path()).expect("save after comment");

    // Reload
    let loaded = ReviewSession::load(storage.path(), &session.session.id).expect("load");
    assert_eq!(loaded.comments.len(), 1);
    assert_eq!(loaded.comments[0].id, comment_id);
    assert_eq!(loaded.comments[0].body, "needs refactoring");
    assert!(!loaded.comments[0].resolved);

    // List active
    let active = ReviewSession::list_active(storage.path()).expect("list");
    assert_eq!(active.len(), 1);

    // End session
    ReviewSession::end(storage.path(), &session.session.id).expect("end");
    let active = ReviewSession::list_active(storage.path()).expect("list after end");
    assert!(active.is_empty());

    // Ended file should exist with -ended suffix
    let ended_path = storage
        .path()
        .join("sessions")
        .join(format!("{}-ended.json", session.session.id));
    assert!(ended_path.exists());
}

#[test]
fn session_json_schema() {
    let storage = tempfile::tempdir().expect("tmpdir");
    let session = ReviewSession::new(
        "/tmp/repo".to_string(),
        "local".to_string(),
        None,
        None,
        "abc123".to_string(),
        vec!["abc123".to_string()],
    );
    session.save(storage.path()).expect("save");

    let json_path = storage
        .path()
        .join("sessions")
        .join(format!("{}.json", session.session.id));
    let raw = std::fs::read_to_string(&json_path).expect("read json");
    let parsed: serde_json::Value = serde_json::from_str(&raw).expect("parse json");

    assert_eq!(parsed["version"], "1.0");
    assert!(parsed["session"]["id"].is_string());
    assert!(parsed["session"]["created_at"].is_string());
    assert!(parsed["comments"].is_array());
    assert!(parsed["edits"].is_array());
}

#[test]
fn multiple_sessions_listed() {
    let storage = tempfile::tempdir().expect("tmpdir");
    let s1 = ReviewSession::new("r".into(), "l".into(), None, None, "a".into(), vec![]);
    let s2 = ReviewSession::new("r".into(), "l".into(), None, None, "b".into(), vec![]);
    s1.save(storage.path()).expect("save s1");
    s2.save(storage.path()).expect("save s2");

    let active = ReviewSession::list_active(storage.path()).expect("list");
    assert_eq!(active.len(), 2);
    assert!(active.contains(&s1.session.id));
    assert!(active.contains(&s2.session.id));
}

#[test]
fn discard_then_list() {
    let storage = tempfile::tempdir().expect("tmpdir");
    let s = ReviewSession::new("r".into(), "l".into(), None, None, "a".into(), vec![]);
    s.save(storage.path()).expect("save");
    ReviewSession::discard(storage.path(), &s.session.id).expect("discard");
    let active = ReviewSession::list_active(storage.path()).expect("list");
    assert!(active.is_empty());
}
