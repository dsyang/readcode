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
			await openPath(logPath);
		}
	}

	return { logPath, showLogs };
}
