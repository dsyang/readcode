import { invoke } from "@tauri-apps/api/core";

// ── Payload type ────────────────────────────────────────────────────
// Intentionally narrow: only primitive values allowed.
// This prevents accidentally passing objects that might contain private data.
type SafeValue = string | number | boolean | null;
type DiagnosticPayload = Record<string, SafeValue>;

// ── Internal helpers ────────────────────────────────────────────────

function logEvent(event: string, payload: DiagnosticPayload = {}): void {
	// Fire-and-forget: logging must never throw or block the caller.
	invoke("log_event", { event: { event, payload } }).catch(() => {});
}

/** Returns a function that returns elapsed milliseconds since it was called. */
export function startTimer(): () => number {
	const t0 = performance.now();
	return () => Math.round(performance.now() - t0);
}

/** Cache of repo path → 8-char hex hash, populated lazily. */
const hashCache = new Map<string, string>();

/**
 * Hashes a string (e.g. a repo path) to an 8-char hex ID using the Rust backend.
 * The result is cached so subsequent calls for the same input are free.
 * NEVER log raw paths — always pass through this function first.
 */
export async function hashPath(path: string): Promise<string> {
	const cached = hashCache.get(path);
	if (cached) return cached;
	try {
		const hashed = await invoke<string>("hash_string_cmd", { input: path });
		hashCache.set(path, hashed);
		return hashed;
	} catch {
		return "unknown";
	}
}

/**
 * Maps an unknown error to a safe, non-private label for logging.
 * NEVER log e.message or e.toString() directly — those strings often contain file paths.
 */
export function classifyFrontendError(e: unknown): string {
	if (e instanceof Error) {
		const msg = e.message.toLowerCase();
		if (msg.includes("not found")) return "not_found";
		if (msg.includes("permission")) return "permission_denied";
		if (msg.includes("no repository")) return "no_repo_open";
		if (msg.includes("no active session")) return "no_session";
		if (msg.includes("bare repository")) return "bare_repo";
		if (msg.includes("no commits")) return "no_commits_selected";
	}
	return "unknown";
}

// ── Public API ──────────────────────────────────────────────────────
// Each method is a typed wrapper that enforces the safe-fields contract.
// Callers cannot accidentally pass private data — the parameters are typed
// to only accept values that are safe to log.

export const diag = {
	appContext(screenWidth: number, screenHeight: number, locale: string): void {
		logEvent("app_context", { screen_width: screenWidth, screen_height: screenHeight, locale });
	},

	repoOpenAttempt(): void {
		logEvent("repo_open_attempt");
	},

	repoOpenSuccess(hashedRepoId: string, commitCount: number, durationMs: number): void {
		logEvent("repo_open_success", { hashed_repo_id: hashedRepoId, commit_count: commitCount, duration_ms: durationMs });
	},

	repoOpenFailure(errorKind: string): void {
		logEvent("repo_open_failure", { error_kind: errorKind });
	},

	commitsLoaded(count: number, durationMs: number): void {
		logEvent("commits_loaded", { count, duration_ms: durationMs });
	},

	diffLoaded(commitCount: number, fileCount: number, totalLines: number, durationMs: number): void {
		logEvent("diff_loaded", {
			selected_commit_count: commitCount,
			file_count: fileCount,
			total_changed_lines: totalLines,
			duration_ms: durationMs,
		});
	},

	fileSelected(count: number): void {
		logEvent("file_selected", { count });
	},

	sessionCreated(): void {
		logEvent("session_created");
	},

	sessionLoaded(): void {
		logEvent("session_loaded");
	},

	sessionEnded(commentCount: number, editCount: number, durationMs: number): void {
		logEvent("session_ended", { comment_count: commentCount, edit_count: editCount, duration_ms: durationMs });
	},

	sessionAbandoned(commentCount: number, editCount: number): void {
		logEvent("session_abandoned", { comment_count: commentCount, edit_count: editCount });
	},

	sessionExported(): void {
		logEvent("session_exported");
	},

	commentAdded(severity: string, commentType: string): void {
		logEvent("comment_added", { severity, comment_type: commentType });
	},

	commentResolved(): void {
		logEvent("comment_resolved");
	},

	commentDeleted(): void {
		logEvent("comment_deleted");
	},

	editApplied(success: boolean): void {
		logEvent("edit_applied", { success });
	},

	ipcError(commandName: string, errorKind: string): void {
		logEvent("ipc_error", { command_name: commandName, error_kind: errorKind });
	},

	jsError(errorClass: string, componentStackDepth: number): void {
		logEvent("js_error", { error_class: errorClass, component_stack_depth: componentStackDepth });
	},

	updaterCheck(available: boolean, currentVersion: string | null, latestVersion: string | null): void {
		logEvent("updater_check", {
			available,
			current_version: currentVersion,
			latest_version: latestVersion,
		});
	},

	updaterError(errorKind: string): void {
		logEvent("updater_error", { error_kind: errorKind });
	},

	bugReportSubmitted(success: boolean): void {
		logEvent("bug_report_submitted", { success });
	},
};

/** Maps updater plugin errors to safe, non-private kind labels. */
export function classifyUpdaterError(e: unknown): string {
	if (e instanceof Error || typeof e === "string") {
		const msg = (e instanceof Error ? e.message : e).toLowerCase();
		if (msg.includes("signature")) return "signature_failed";
		if (msg.includes("no available") || msg.includes("target")) return "no_platform";
		if (msg.includes("parse") || msg.includes("json")) return "parse_error";
		if (msg.includes("network") || msg.includes("fetch") || msg.includes("request") || msg.includes("connect") || msg.includes("dns")) return "network";
	}
	return "unknown";
}
