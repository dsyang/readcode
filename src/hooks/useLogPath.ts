import { invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import { useState, useEffect } from "react";

export function useLogPath() {
	const [logPath, setLogPath] = useState<string | null>(null);

	useEffect(() => {
		invoke<string>("get_log_path").then(setLogPath).catch(() => {});
	}, []);

	async function showLogs() {
		if (logPath) {
			try {
				await openPath(logPath);
			} catch (err) {
				alert(`Failed to open log folder:\n${logPath}\n\n${err}`);
			}
		} else {
			alert("Log path not yet available.");
		}
	}

	return { logPath, showLogs };
}
