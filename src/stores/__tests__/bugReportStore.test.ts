import { describe, it, expect, beforeEach, vi } from "vitest";
import { useBugReportStore } from "../bugReportStore";

vi.mock("../../api/bugReport", () => ({
	saveBugReport: vi.fn(),
	captureScreenshot: vi.fn(),
}));
vi.mock("../../diagnostics", () => ({
	diag: { bugReportSubmitted: vi.fn() },
}));

import { captureScreenshot, saveBugReport } from "../../api/bugReport";
import { diag } from "../../diagnostics";

const mockedSave = vi.mocked(saveBugReport);
const mockedCapture = vi.mocked(captureScreenshot);
const mockedDiag = vi.mocked(diag.bugReportSubmitted);

const sampleCap = (path: string) => ({ path, data_url: `data:image/png;base64,${path}` });

beforeEach(() => {
	useBugReportStore.getState().reset();
	mockedSave.mockReset();
	mockedCapture.mockReset();
	mockedDiag.mockReset();
	vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
		cb(0);
		return 0;
	});
	// devicePixelRatio is read at submit time; jsdom defaults to 1.
	Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 2 });
});

describe("bugReportStore", () => {
	it("enter captures, transitions to placing, and stores frozen image", async () => {
		mockedCapture.mockResolvedValueOnce(sampleCap("/tmp/cap1.png"));
		await useBugReportStore.getState().enter();
		const s = useBugReportStore.getState();
		expect(s.mode).toBe("placing");
		expect(s.frozenImage).toBe("data:image/png;base64,/tmp/cap1.png");
		expect(s.screenshotPath).toBe("/tmp/cap1.png");
	});

	it("enter is a no-op if not idle", async () => {
		mockedCapture.mockResolvedValueOnce(sampleCap("/tmp/a.png"));
		await useBugReportStore.getState().enter();
		await useBugReportStore.getState().enter();
		expect(mockedCapture).toHaveBeenCalledTimes(1);
	});

	it("enter records error and returns to idle on capture failure", async () => {
		mockedCapture.mockRejectedValueOnce(new Error("boom"));
		await useBugReportStore.getState().enter();
		const s = useBugReportStore.getState();
		expect(s.mode).toBe("idle");
		expect(s.error).toBe("boom");
	});

	it("placeDot from placing transitions straight to editing without a second capture", async () => {
		mockedCapture.mockResolvedValueOnce(sampleCap("/tmp/cap1.png"));
		await useBugReportStore.getState().enter();
		mockedCapture.mockClear();
		useBugReportStore.getState().placeDot(120, 240);
		const s = useBugReportStore.getState();
		expect(s.mode).toBe("editing");
		expect(s.dot).toEqual({ x: 120, y: 240 });
		expect(s.screenshotPath).toBe("/tmp/cap1.png");
		expect(mockedCapture).not.toHaveBeenCalled();
	});

	it("placeDot is a no-op outside placing mode", () => {
		useBugReportStore.getState().placeDot(10, 10);
		expect(useBugReportStore.getState().mode).toBe("idle");
		expect(useBugReportStore.getState().dot).toBeNull();
		expect(mockedCapture).not.toHaveBeenCalled();
	});

	it("cancel from any stage returns to idle and clears state", async () => {
		mockedCapture.mockResolvedValueOnce(sampleCap("/tmp/cap1.png"));
		await useBugReportStore.getState().enter();
		useBugReportStore.getState().placeDot(5, 5);
		useBugReportStore.getState().setDescription("hi");
		useBugReportStore.getState().cancel();
		const s = useBugReportStore.getState();
		expect(s.mode).toBe("idle");
		expect(s.dot).toBeNull();
		expect(s.description).toBe("");
		expect(s.frozenImage).toBeNull();
		expect(s.screenshotPath).toBeNull();
	});

	it("submit happy path sends original screenshot path + pixel_ratio", async () => {
		mockedCapture.mockResolvedValueOnce(sampleCap("/tmp/cap1.png"));
		mockedSave.mockResolvedValueOnce({
			timestamp: "t",
			description: "bug",
			screenshot_path: "/p.png",
			logs_path: "/p.log",
			x: 1,
			y: 2,
		});
		await useBugReportStore.getState().enter();
		useBugReportStore.getState().placeDot(1, 2);
		useBugReportStore.getState().setDescription("bug");
		await useBugReportStore.getState().submit();
		expect(mockedSave).toHaveBeenCalledWith({
			description: "bug",
			x: 1,
			y: 2,
			pixel_ratio: 2,
			screenshot_path: "/tmp/cap1.png",
		});
		expect(mockedDiag).toHaveBeenCalledWith(true);
		expect(useBugReportStore.getState().mode).toBe("idle");
	});

	it("submit failure stays in editing with error and reports failure", async () => {
		mockedCapture.mockResolvedValueOnce(sampleCap("/tmp/cap1.png"));
		mockedSave.mockRejectedValueOnce(new Error("disk full"));
		await useBugReportStore.getState().enter();
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
