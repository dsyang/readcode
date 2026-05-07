import { invoke } from "@tauri-apps/api/core";
import type { BugReportEntry, SaveBugReportArgs } from "./generatedTypes";

export async function saveBugReport(args: SaveBugReportArgs): Promise<BugReportEntry> {
	return invoke<BugReportEntry>("save_bug_report", { args });
}
