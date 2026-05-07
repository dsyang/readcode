import { create } from "zustand";
import { saveBugReport } from "../api/bugReport";
import { diag } from "../diagnostics";

export type BugReportMode = "idle" | "placing" | "editing" | "submitting";

interface BugReportState {
	mode: BugReportMode;
	dot: { x: number; y: number } | null;
	description: string;
	error: string | null;
	enter: () => void;
	placeDot: (x: number, y: number) => void;
	setDescription: (s: string) => void;
	submit: () => Promise<void>;
	cancel: () => void;
	reset: () => void;
}

// Two RAFs guarantee React commits and the browser paints the popover-hidden
// state before the screen is captured — single RAF can race with React commit.
function nextPaint(): Promise<void> {
	return new Promise((resolve) => {
		requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
	});
}

export const useBugReportStore = create<BugReportState>((set, get) => ({
	mode: "idle",
	dot: null,
	description: "",
	error: null,

	enter: () => set({ mode: "placing", dot: null, description: "", error: null }),

	placeDot: (x, y) => {
		if (get().mode !== "placing") return;
		set({ mode: "editing", dot: { x, y } });
	},

	setDescription: (s) => set({ description: s }),

	submit: async () => {
		const { dot, description, mode } = get();
		if (mode !== "editing" || !dot) return;
		set({ mode: "submitting", error: null });
		await nextPaint();
		try {
			await saveBugReport({ description, x: dot.x, y: dot.y });
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

	reset: () => set({ mode: "idle", dot: null, description: "", error: null }),
}));
