use std::path::{Path, PathBuf};
use std::time::Instant;

use chrono::{Local, Utc};
use serde::{Deserialize, Serialize};
use tauri::State;
#[cfg(feature = "ts-export")]
use ts_rs::TS;

use super::diagnostics::{log_ipc_call, DiagnosticsState};

#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../bindings/")
)]
pub struct SaveBugReportArgs {
    pub description: String,
    pub x: u32,
    pub y: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../bindings/")
)]
pub struct BugReportEntry {
    pub timestamp: String,
    pub description: String,
    pub screenshot_path: String,
    pub logs_path: String,
    pub x: u32,
    pub y: u32,
}

const WINDOW_TITLE_NEEDLE: &str = "ReadCode";

fn capture_window_or_monitor(out_path: &Path) -> Result<(), String> {
    // Prefer capturing the app's own window so multi-monitor layouts and
    // off-screen pixels are handled correctly. Fall back to primary monitor.
    if let Ok(windows) = xcap::Window::all() {
        for w in windows {
            let title = w.title().unwrap_or_default();
            if title.contains(WINDOW_TITLE_NEEDLE) {
                let img = w
                    .capture_image()
                    .map_err(|e| format!("window capture failed: {e}"))?;
                return img
                    .save(out_path)
                    .map_err(|e| format!("save png failed: {e}"));
            }
        }
    }
    let monitors = xcap::Monitor::all().map_err(|e| format!("enumerate monitors: {e}"))?;
    let monitor = monitors
        .into_iter()
        .next()
        .ok_or_else(|| "no monitors available".to_string())?;
    let img = monitor
        .capture_image()
        .map_err(|e| format!("monitor capture failed: {e}"))?;
    img.save(out_path)
        .map_err(|e| format!("save png failed: {e}"))
}

fn snapshot_today_log(log_dir: &Path, dest: &Path) -> Result<(), String> {
    let today = Local::now().format("%Y-%m-%d").to_string();
    let src = log_dir.join(format!("readcode.log.{today}"));
    if src.exists() {
        std::fs::copy(&src, dest)
            .map(|_| ())
            .map_err(|e| format!("copy log failed: {e}"))
    } else {
        std::fs::write(dest, "(no log file for today)\n")
            .map_err(|e| format!("write placeholder log failed: {e}"))
    }
}

fn append_bug_entry(bugs_dir: &Path, entry: &BugReportEntry) -> Result<(), String> {
    let json_path = bugs_dir.join("bugs.json");
    let mut entries: Vec<BugReportEntry> = match std::fs::read_to_string(&json_path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_else(|e| {
            tracing::warn!(
                event = "bugs_json_parse_failed",
                error = %e,
            );
            Vec::new()
        }),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
        Err(e) => return Err(format!("read bugs.json: {e}")),
    };
    entries.push(entry.clone());
    let payload =
        serde_json::to_string_pretty(&entries).map_err(|e| format!("serialize bugs: {e}"))?;
    let tmp = bugs_dir.join("bugs.json.tmp");
    std::fs::write(&tmp, payload).map_err(|e| format!("write bugs.json.tmp: {e}"))?;
    std::fs::rename(&tmp, &json_path).map_err(|e| format!("rename bugs.json: {e}"))?;
    Ok(())
}

fn run_save(args: SaveBugReportArgs, log_dir: PathBuf) -> Result<BugReportEntry, String> {
    let bugs_dir = log_dir.join("bugs");
    std::fs::create_dir_all(&bugs_dir).map_err(|e| format!("create bugs dir: {e}"))?;

    let ts = Utc::now().format("%Y%m%dT%H%M%S").to_string();
    let png_path = bugs_dir.join(format!("bug_{ts}.png"));
    let log_path = bugs_dir.join(format!("bug_{ts}.log"));

    capture_window_or_monitor(&png_path)?;
    snapshot_today_log(&log_dir, &log_path)?;

    let entry = BugReportEntry {
        timestamp: ts,
        description: args.description,
        screenshot_path: png_path.to_string_lossy().to_string(),
        logs_path: log_path.to_string_lossy().to_string(),
        x: args.x,
        y: args.y,
    };
    append_bug_entry(&bugs_dir, &entry)?;
    Ok(entry)
}

#[tauri::command]
pub async fn save_bug_report(
    args: SaveBugReportArgs,
    diag: State<'_, DiagnosticsState>,
) -> Result<BugReportEntry, String> {
    let start = Instant::now();
    let log_dir = diag.log_path.clone();
    let result = tokio::task::spawn_blocking(move || run_save(args, log_dir))
        .await
        .map_err(|e| format!("join error: {e}"))
        .and_then(|r| r);
    log_ipc_call("save_bug_report", start, &result);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn sample_entry(ts: &str) -> BugReportEntry {
        BugReportEntry {
            timestamp: ts.to_string(),
            description: "test".to_string(),
            screenshot_path: format!("/tmp/{ts}.png"),
            logs_path: format!("/tmp/{ts}.log"),
            x: 100,
            y: 200,
        }
    }

    #[test]
    fn append_creates_file_when_missing() {
        let dir = tempdir().unwrap();
        let entry = sample_entry("20260506T120000");
        append_bug_entry(dir.path(), &entry).unwrap();
        let s = std::fs::read_to_string(dir.path().join("bugs.json")).unwrap();
        let parsed: Vec<BugReportEntry> = serde_json::from_str(&s).unwrap();
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].timestamp, "20260506T120000");
    }

    #[test]
    fn append_extends_existing_array() {
        let dir = tempdir().unwrap();
        append_bug_entry(dir.path(), &sample_entry("a")).unwrap();
        append_bug_entry(dir.path(), &sample_entry("b")).unwrap();
        let s = std::fs::read_to_string(dir.path().join("bugs.json")).unwrap();
        let parsed: Vec<BugReportEntry> = serde_json::from_str(&s).unwrap();
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[1].timestamp, "b");
    }

    #[test]
    fn append_resets_on_malformed_file() {
        let dir = tempdir().unwrap();
        std::fs::write(dir.path().join("bugs.json"), "not json {{").unwrap();
        append_bug_entry(dir.path(), &sample_entry("x")).unwrap();
        let s = std::fs::read_to_string(dir.path().join("bugs.json")).unwrap();
        let parsed: Vec<BugReportEntry> = serde_json::from_str(&s).unwrap();
        assert_eq!(parsed.len(), 1);
    }

    #[test]
    fn snapshot_writes_placeholder_when_no_log() {
        let dir = tempdir().unwrap();
        let dest = dir.path().join("snap.log");
        snapshot_today_log(dir.path(), &dest).unwrap();
        let contents = std::fs::read_to_string(&dest).unwrap();
        assert!(contents.contains("no log file"));
    }

    #[test]
    fn snapshot_copies_existing_log() {
        let dir = tempdir().unwrap();
        let today = Local::now().format("%Y-%m-%d").to_string();
        let src = dir.path().join(format!("readcode.log.{today}"));
        std::fs::write(&src, "hello").unwrap();
        let dest = dir.path().join("snap.log");
        snapshot_today_log(dir.path(), &dest).unwrap();
        assert_eq!(std::fs::read_to_string(&dest).unwrap(), "hello");
    }
}
