import { create } from "zustand";
import { captureScreenshot, saveBugReport } from "../api/bugReport";
import { diag } from "../diagnostics";

export type BugReportMode =
	| "idle"
	| "capturing1"
	| "placing"
	| "editing"
	| "submitting";

interface BugReportState {
	mode: BugReportMode;
	dot: { x: number; y: number } | null;
	description: string;
	error: string | null;
	frozenImage: string | null;
	screenshotPath: string | null;
	enter: () => Promise<void>;
	placeDot: (x: number, y: number) => void;
	setDescription: (s: string) => void;
	submit: () => Promise<void>;
	cancel: () => void;
	reset: () => void;
}

export const useBugReportStore = create<BugReportState>((set, get) => ({
	mode: "idle",
	dot: null,
	description: "",
	error: null,
	frozenImage: null,
	screenshotPath: null,

	enter: async () => {
		if (get().mode !== "idle") return;
		set({
			mode: "capturing1",
			dot: null,
			description: "",
			error: null,
			frozenImage: null,
			screenshotPath: null,
		});
		try {
			const cap = await captureScreenshot();
			// User may have canceled while the capture was in flight.
			if (get().mode !== "capturing1") return;
			set({
				mode: "placing",
				frozenImage: cap.data_url,
				screenshotPath: cap.path,
			});
		} catch (e) {
			diag.bugReportSubmitted(false);
			set({
				mode: "idle",
				error: e instanceof Error ? e.message : String(e),
			});
		}
	},

	placeDot: (x, y) => {
		if (get().mode !== "placing") return;
		set({ mode: "editing", dot: { x, y } });
	},

	setDescription: (s) => set({ description: s }),

	submit: async () => {
		const { dot, description, mode, screenshotPath } = get();
		if (mode !== "editing" || !dot || !screenshotPath) return;
		set({ mode: "submitting", error: null });
		try {
			await saveBugReport({
				description,
				x: dot.x,
				y: dot.y,
				pixel_ratio: window.devicePixelRatio || 1,
				screenshot_path: screenshotPath,
			});
			diag.bugReportSubmitted(true);
			get().reset();
		} catch (e) {
			diag.bugReportSubmitted(false);
			set({
				mode: "editing",
				error: e instanceof Error ? e.message : String(e),
			});
		}
	},

	cancel: () => get().reset(),

	reset: () =>
		set({
			mode: "idle",
			dot: null,
			description: "",
			error: null,
			frozenImage: null,
			screenshotPath: null,
		}),
}));
