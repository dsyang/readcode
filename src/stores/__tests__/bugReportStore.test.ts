import { describe, it, expect, beforeEach, vi } from "vitest";
import { useBugReportStore } from "../bugReportStore";

vi.mock("../../api/bugReport", () => ({
	saveBugReport: vi.fn(),
}));
vi.mock("../../diagnostics", () => ({
	diag: { bugReportSubmitted: vi.fn() },
}));

import { saveBugReport } from "../../api/bugReport";
import { diag } from "../../diagnostics";

const mockedSave = vi.mocked(saveBugReport);
const mockedDiag = vi.mocked(diag.bugReportSubmitted);

beforeEach(() => {
	useBugReportStore.getState().reset();
	mockedSave.mockReset();
	mockedDiag.mockReset();
	// Make rAF synchronous so submit() resolves quickly under jsdom.
	vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
		cb(0);
		return 0;
	});
});

describe("bugReportStore", () => {
	it("enter transitions to placing and clears prior state", () => {
		useBugReportStore.setState({ description: "old", error: "x" });
		useBugReportStore.getState().enter();
		const s = useBugReportStore.getState();
		expect(s.mode).toBe("placing");
		expect(s.dot).toBeNull();
		expect(s.description).toBe("");
		expect(s.error).toBeNull();
	});

	it("placeDot from placing transitions to editing and stores coords", () => {
		useBugReportStore.getState().enter();
		useBugReportStore.getState().placeDot(120, 240);
		const s = useBugReportStore.getState();
		expect(s.mode).toBe("editing");
		expect(s.dot).toEqual({ x: 120, y: 240 });
	});

	it("placeDot is a no-op outside placing mode", () => {
		useBugReportStore.getState().placeDot(10, 10);
		expect(useBugReportStore.getState().mode).toBe("idle");
		expect(useBugReportStore.getState().dot).toBeNull();
	});

	it("cancel from any stage returns to idle and clears state", () => {
		useBugReportStore.getState().enter();
		useBugReportStore.getState().placeDot(5, 5);
		useBugReportStore.getState().setDescription("hi");
		useBugReportStore.getState().cancel();
		const s = useBugReportStore.getState();
		expect(s.mode).toBe("idle");
		expect(s.dot).toBeNull();
		expect(s.description).toBe("");
	});

	it("submit happy path resets to idle and reports success", async () => {
		mockedSave.mockResolvedValueOnce({
			timestamp: "t",
			description: "bug",
			screenshot_path: "/p.png",
			logs_path: "/p.log",
			x: 1,
			y: 2,
		});
		useBugReportStore.getState().enter();
		useBugReportStore.getState().placeDot(1, 2);
		useBugReportStore.getState().setDescription("bug");
		await useBugReportStore.getState().submit();
		expect(mockedSave).toHaveBeenCalledWith({ description: "bug", x: 1, y: 2 });
		expect(mockedDiag).toHaveBeenCalledWith(true);
		expect(useBugReportStore.getState().mode).toBe("idle");
	});

	it("submit failure stays in editing with error and reports failure", async () => {
		mockedSave.mockRejectedValueOnce(new Error("disk full"));
		useBugReportStore.getState().enter();
		useBugReportStore.getState().placeDot(1, 2);
		useBugReportStore.getState().setDescription("bug");
		await useBugReportStore.getState().submit();
		const s = useBugReportStore.getState();
		expect(s.mode).toBe("editing");
		expect(s.error).toBe("disk full");
		expect(mockedDiag).toHaveBeenCalledWith(false);
	});

	it("submit is a no-op without a placed dot", async () => {
		await useBugReportStore.getState().submit();
		expect(mockedSave).not.toHaveBeenCalled();
	});
});
