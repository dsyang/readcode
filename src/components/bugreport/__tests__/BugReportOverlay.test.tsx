import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useBugReportStore } from "../../../stores/bugReportStore";
import { BugReportOverlay } from "../BugReportOverlay";

vi.mock("../../../api/bugReport", () => ({
	saveBugReport: vi.fn(),
	captureScreenshot: vi.fn(),
}));
vi.mock("../../../diagnostics", () => ({
	diag: { bugReportSubmitted: vi.fn() },
}));

import { captureScreenshot, saveBugReport } from "../../../api/bugReport";

const mockedCapture = vi.mocked(captureScreenshot);
const mockedSave = vi.mocked(saveBugReport);

const cap = (path: string) => ({ path, data_url: `data:image/png;base64,${path}` });

beforeEach(() => {
	useBugReportStore.getState().reset();
	mockedCapture.mockReset();
	mockedSave.mockReset();
	vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
		cb(0);
		return 0;
	});
});

describe("BugReportOverlay", () => {
	it("renders nothing when idle", () => {
		const { container } = render(<BugReportOverlay />);
		expect(container.querySelector("[data-testid=bug-report-overlay]")).toBeNull();
	});

	it("during placing, shows the frozen image and the placement banner", () => {
		useBugReportStore.setState({
			mode: "placing",
			frozenImage: "data:image/png;base64,abc",
			screenshotPath: "/tmp/cap1.png",
		});
		render(<BugReportOverlay />);
		const overlay = screen.getByTestId("bug-report-overlay");
		const img = overlay.querySelector("img");
		expect(img).toBeTruthy();
		expect(img!.getAttribute("src")).toBe("data:image/png;base64,abc");
		expect(screen.getByText(/Click anywhere to mark the issue/)).toBeInTheDocument();
		expect(overlay.style.cursor).toBe("crosshair");
	});

	it("during capturing1, blocks clicks but does not render the image yet", () => {
		useBugReportStore.setState({ mode: "capturing1", frozenImage: null });
		render(<BugReportOverlay />);
		const overlay = screen.getByTestId("bug-report-overlay");
		expect(overlay.querySelector("img")).toBeNull();
		// Banner only appears in placing mode.
		expect(screen.queryByText(/Click anywhere to mark the issue/)).toBeNull();
	});

	it("clicking the overlay during placing places a dot and goes to editing without a second capture", () => {
		useBugReportStore.setState({
			mode: "placing",
			frozenImage: "data:image/png;base64,abc",
			screenshotPath: "/tmp/cap1.png",
		});
		render(<BugReportOverlay />);
		const overlay = screen.getByTestId("bug-report-overlay");
		fireEvent.click(overlay, { clientX: 42, clientY: 84 });
		const s = useBugReportStore.getState();
		expect(s.mode).toBe("editing");
		expect(s.dot).toEqual({ x: 42, y: 84 });
		expect(s.screenshotPath).toBe("/tmp/cap1.png");
		expect(mockedCapture).not.toHaveBeenCalled();
	});

	it("during editing, shows the description popover and the dot", () => {
		useBugReportStore.setState({
			mode: "editing",
			frozenImage: "data:image/png;base64,xyz",
			screenshotPath: "/tmp/cap2.png",
			dot: { x: 50, y: 60 },
		});
		render(<BugReportOverlay />);
		expect(screen.getByText("Describe the bug")).toBeInTheDocument();
		expect(screen.getByPlaceholderText("What's wrong here?")).toBeInTheDocument();
	});

	it("Esc cancels and resets to idle", () => {
		useBugReportStore.setState({
			mode: "editing",
			frozenImage: "data:image/png;base64,xyz",
			screenshotPath: "/tmp/cap2.png",
			dot: { x: 1, y: 2 },
			description: "anything",
		});
		render(<BugReportOverlay />);
		fireEvent.keyDown(window, { key: "Escape" });
		const s = useBugReportStore.getState();
		expect(s.mode).toBe("idle");
		expect(s.frozenImage).toBeNull();
		expect(s.dot).toBeNull();
	});

	it("Cmd+Shift+B enters bug-report mode", async () => {
		mockedCapture.mockResolvedValueOnce(cap("/tmp/cap1.png"));
		render(<BugReportOverlay />);
		await act(async () => {
			fireEvent.keyDown(window, { key: "b", metaKey: true, shiftKey: true });
		});
		await waitFor(() => {
			expect(useBugReportStore.getState().mode).toBe("placing");
		});
		expect(mockedCapture).toHaveBeenCalledTimes(1);
	});

	it("Ctrl+Shift+B also enters bug-report mode (Windows/Linux)", async () => {
		mockedCapture.mockResolvedValueOnce(cap("/tmp/cap1.png"));
		render(<BugReportOverlay />);
		await act(async () => {
			fireEvent.keyDown(window, { key: "B", ctrlKey: true, shiftKey: true });
		});
		await waitFor(() => {
			expect(useBugReportStore.getState().mode).toBe("placing");
		});
	});

	it("plain Cmd+B (without Shift) does not enter bug-report mode", () => {
		render(<BugReportOverlay />);
		fireEvent.keyDown(window, { key: "b", metaKey: true });
		expect(useBugReportStore.getState().mode).toBe("idle");
		expect(mockedCapture).not.toHaveBeenCalled();
	});
});
