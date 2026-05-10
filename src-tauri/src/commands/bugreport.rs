use std::path::{Path, PathBuf};
use std::time::Instant;

use base64::Engine;
use chrono::{Local, Utc};
use image::{Rgba, RgbaImage};
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
    // x/y are CSS pixels from the click (clientX/clientY); the backend
    // multiplies by pixel_ratio to find the matching device-pixel position
    // in the saved screenshot.
    pub x: u32,
    pub y: u32,
    pub pixel_ratio: f32,
    pub screenshot_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../bindings/")
)]
pub struct CapturedScreenshot {
    pub path: String,
    pub data_url: String,
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

// Matches the CSS `DOT_SIZE = 18` in BugReportOverlay.tsx (radius 9, white
// border 2px). Backend scales by pixel_ratio for HiDPI screenshots.
const DOT_RADIUS_CSS: f32 = 9.0;
const DOT_BORDER_CSS: f32 = 2.0;

fn draw_dot(img: &mut RgbaImage, cx: i32, cy: i32, outer_r: i32, border: i32) {
    let inner_r = (outer_r - border).max(1);
    let red = Rgba([239u8, 68, 68, 255]);
    let white = Rgba([255u8, 255, 255, 255]);
    let w = img.width() as i32;
    let h = img.height() as i32;
    for dy in -outer_r..=outer_r {
        for dx in -outer_r..=outer_r {
            let x = cx + dx;
            let y = cy + dy;
            if x < 0 || y < 0 || x >= w || y >= h {
                continue;
            }
            let d2 = dx * dx + dy * dy;
            if d2 <= inner_r * inner_r {
                img.put_pixel(x as u32, y as u32, red);
            } else if d2 <= outer_r * outer_r {
                img.put_pixel(x as u32, y as u32, white);
            }
        }
    }
}

fn stamp_dot_on_png(path: &Path, x: u32, y: u32, pixel_ratio: f32) -> Result<(), String> {
    let img = image::open(path).map_err(|e| format!("read png: {e}"))?;
    let mut rgba = img.into_rgba8();
    let cx = (x as f32 * pixel_ratio).round() as i32;
    let cy = (y as f32 * pixel_ratio).round() as i32;
    let outer_r = (DOT_RADIUS_CSS * pixel_ratio).round().max(1.0) as i32;
    let border = (DOT_BORDER_CSS * pixel_ratio).round().max(1.0) as i32;
    draw_dot(&mut rgba, cx, cy, outer_r, border);
    rgba.save(path).map_err(|e| format!("save png: {e}"))
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

fn run_capture(log_dir: PathBuf) -> Result<CapturedScreenshot, String> {
    let bugs_dir = log_dir.join("bugs");
    std::fs::create_dir_all(&bugs_dir).map_err(|e| format!("create bugs dir: {e}"))?;
    // Unique name per capture so capture1 and capture2 don't overwrite each other.
    let ts = Utc::now().format("%Y%m%dT%H%M%S%3f").to_string();
    let png_path = bugs_dir.join(format!("cap_{ts}.png"));
    capture_window_or_monitor(&png_path)?;
    let bytes = std::fs::read(&png_path).map_err(|e| format!("read png: {e}"))?;
    let data_url = format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(&bytes)
    );
    Ok(CapturedScreenshot {
        path: png_path.to_string_lossy().to_string(),
        data_url,
    })
}

fn run_save(args: SaveBugReportArgs, log_dir: PathBuf) -> Result<BugReportEntry, String> {
    let bugs_dir = log_dir.join("bugs");
    std::fs::create_dir_all(&bugs_dir).map_err(|e| format!("create bugs dir: {e}"))?;

    let ts = Utc::now().format("%Y%m%dT%H%M%S").to_string();
    let png_path = bugs_dir.join(format!("bug_{ts}.png"));
    let log_path = bugs_dir.join(format!("bug_{ts}.log"));

    let staged = PathBuf::from(&args.screenshot_path);
    if !staged.exists() {
        return Err(format!("screenshot not found: {}", staged.display()));
    }
    std::fs::rename(&staged, &png_path).map_err(|e| format!("move screenshot: {e}"))?;
    stamp_dot_on_png(&png_path, args.x, args.y, args.pixel_ratio)?;
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

#[tauri::command]
pub async fn capture_screenshot(
    diag: State<'_, DiagnosticsState>,
) -> Result<CapturedScreenshot, String> {
    let start = Instant::now();
    let log_dir = diag.log_path.clone();
    let result = tokio::task::spawn_blocking(move || run_capture(log_dir))
        .await
        .map_err(|e| format!("join error: {e}"))
        .and_then(|r| r);
    log_ipc_call("capture_screenshot", start, &result);
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

    fn write_blank_png(path: &Path, w: u32, h: u32) {
        let img = RgbaImage::from_pixel(w, h, Rgba([0, 0, 0, 255]));
        img.save(path).unwrap();
    }

    #[test]
    fn run_save_renames_staged_screenshot_and_stamps_dot() {
        let dir = tempdir().unwrap();
        let bugs_dir = dir.path().join("bugs");
        std::fs::create_dir_all(&bugs_dir).unwrap();
        let staged = bugs_dir.join("cap_staging.png");
        write_blank_png(&staged, 200, 100);
        let entry = run_save(
            SaveBugReportArgs {
                description: "x".to_string(),
                x: 50,
                y: 50,
                pixel_ratio: 1.0,
                screenshot_path: staged.to_string_lossy().to_string(),
            },
            dir.path().to_path_buf(),
        )
        .unwrap();
        assert!(!staged.exists(), "staged file should be moved");
        let final_path = PathBuf::from(&entry.screenshot_path);
        assert!(final_path.exists());

        // Center pixel of the dot must be the red fill.
        let img = image::open(&final_path).unwrap().to_rgba8();
        let center = img.get_pixel(50, 50);
        assert_eq!(center.0, [239, 68, 68, 255]);

        // A pixel just inside the outer radius (radius 9) is part of the
        // white border ring, not red.
        let edge = img.get_pixel(50 + 8, 50);
        assert_eq!(edge.0, [255, 255, 255, 255]);

        // A pixel well outside the dot is unchanged (black background).
        let bg = img.get_pixel(0, 0);
        assert_eq!(bg.0, [0, 0, 0, 255]);
    }

    #[test]
    fn run_save_errors_when_screenshot_missing() {
        let dir = tempdir().unwrap();
        let err = run_save(
            SaveBugReportArgs {
                description: "x".to_string(),
                x: 0,
                y: 0,
                pixel_ratio: 1.0,
                screenshot_path: "/does/not/exist.png".to_string(),
            },
            dir.path().to_path_buf(),
        )
        .unwrap_err();
        assert!(err.contains("not found"));
    }

    #[test]
    fn draw_dot_clips_at_image_bounds() {
        let mut img = RgbaImage::from_pixel(10, 10, Rgba([0, 0, 0, 255]));
        // Center off the canvas; should not panic.
        draw_dot(&mut img, -5, -5, 9, 2);
        // Far corner stays black (the dot is fully clipped).
        assert_eq!(img.get_pixel(9, 9).0, [0, 0, 0, 255]);
    }

    #[test]
    fn draw_dot_scales_with_pixel_ratio() {
        let dir = tempdir().unwrap();
        let png = dir.path().join("p.png");
        write_blank_png(&png, 400, 400);
        // Click at CSS (100, 100) on a 2x display → device (200, 200).
        stamp_dot_on_png(&png, 100, 100, 2.0).unwrap();
        let img = image::open(&png).unwrap().to_rgba8();
        assert_eq!(img.get_pixel(200, 200).0, [239, 68, 68, 255]);
        // CSS-coord position is *not* the dot center on a 2x display.
        assert_eq!(img.get_pixel(100, 100).0, [0, 0, 0, 255]);
    }
}
