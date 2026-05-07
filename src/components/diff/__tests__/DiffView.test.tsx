import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MergeView } from "@codemirror/merge";
import { EditorView } from "@codemirror/view";
import { DiffView, type MergeViewFactory } from "../DiffView";
import { useReviewStore } from "../../../stores/reviewStore";
import { useSelectionStore } from "../../../stores/selectionStore";
import {
	clearInvocations,
	getInvocationsFor,
	setupMultiFileRepo,
} from "../../../test/tauriMock";
import type { FileDiffContent, MergedDiff } from "../../../api/types";

type MergeViewConfig = ConstructorParameters<typeof MergeView>[0];

interface StubView {
	config: MergeViewConfig;
	a: { dispatch: ReturnType<typeof vi.fn>; state: { doc: { toString: () => string } } };
	b: { dispatch: ReturnType<typeof vi.fn>; state: { doc: { toString: () => string } } };
	destroy: ReturnType<typeof vi.fn>;
}

function makeStubFactory(): { factory: MergeViewFactory; views: StubView[] } {
	const views: StubView[] = [];
	const factory: MergeViewFactory = (config) => {
		const stub: StubView = {
			config,
			a: {
				dispatch: vi.fn(),
				state: { doc: { toString: () => String(config.a?.doc ?? "") } },
			},
			b: {
				dispatch: vi.fn(),
				state: { doc: { toString: () => String(config.b?.doc ?? "") } },
			},
			destroy: vi.fn(),
		};
		views.push(stub);
		return stub as unknown as MergeView;
	};
	return { factory, views };
}

function resetStores(): void {
	useReviewStore.setState({
		session: null,
		isSessionActive: false,
		editMode: false,
		pendingComment: null,
		scrollTarget: null,
		existingSessionIds: [],
	});
	useSelectionStore.setState({
		repoPath: "/mock/repo/",
		currentBranch: "main",
		connectionMode: "local",
		remoteProfileName: null,
		commits: [],
		isLoading: false,
		error: null,
		recentRepos: [],
		selectedCommitOids: new Set(),
		lastClickedCommitOid: null,
		includeWorkingTree: false,
		mergedDiff: null,
		selectedFilePaths: new Set(),
		lastClickedFilePath: null,
		fileDiffContents: new Map(),
		isDiffLoading: false,
	});
}

function makeMergedDiff(paths: string[]): MergedDiff {
	return {
		files: paths.map((p) => ({
			path: p,
			status: "Modified",
			old_path: null,
			additions: 1,
			deletions: 1,
		})),
		base_oid: "base",
		head_description: "head",
	};
}

function makeContent(path: string, oldDoc: string, newDoc: string): FileDiffContent {
	return { path, old_content: oldDoc, new_content: newDoc, status: "Modified" };
}

describe("DiffView", () => {
	beforeEach(() => {
		resetStores();
		clearInvocations();
	});

	it("shows the empty placeholder when no merged diff is loaded", () => {
		render(<DiffView />);
		expect(screen.getByText("Select commits to see diffs")).toBeInTheDocument();
	});

	it("prompts to select files when merged diff is present but no paths selected", () => {
		useSelectionStore.setState({ mergedDiff: makeMergedDiff(["a.ts"]) });
		render(<DiffView />);
		expect(screen.getByText("Select files to view their diffs")).toBeInTheDocument();
	});

	it("shows the loading indicator while diffs are still streaming in", () => {
		useSelectionStore.setState({
			mergedDiff: makeMergedDiff(["a.ts"]),
			selectedFilePaths: new Set(["a.ts"]),
			isDiffLoading: true,
			fileDiffContents: new Map(),
		});
		render(<DiffView />);
		expect(screen.getByText("Loading diffs...")).toBeInTheDocument();
	});

	it("constructs one MergeView per selected file in mergedDiff order", () => {
		const paths = ["src/a.ts", "src/b.ts", "src/c.ts"];
		setupMultiFileRepo({
			files: paths.map((p) => ({ path: p, oldContent: `old ${p}`, newContent: `new ${p}` })),
		});
		useSelectionStore.setState({
			mergedDiff: makeMergedDiff(paths),
			selectedFilePaths: new Set(paths),
			fileDiffContents: new Map(paths.map((p) => [p, makeContent(p, `old ${p}`, `new ${p}`)])),
			isDiffLoading: false,
		});

		const { factory, views } = makeStubFactory();
		const { container } = render(<DiffView mergeViewFactory={factory} />);

		expect(views).toHaveLength(3);
		expect(views.map((v) => v.config.a?.doc)).toEqual(["old src/a.ts", "old src/b.ts", "old src/c.ts"]);
		expect(views.map((v) => v.config.b?.doc)).toEqual(["new src/a.ts", "new src/b.ts", "new src/c.ts"]);
		// Section order in the DOM matches mergedDiff.files order.
		const sections = Array.from(container.querySelectorAll("[data-file-path]"));
		expect(sections.map((s) => s.getAttribute("data-file-path"))).toEqual(paths);
	});

	it("passes the canonical MergeView config (gutter, collapseUnchanged, highlightChanges)", () => {
		const path = "src/a.ts";
		useSelectionStore.setState({
			mergedDiff: makeMergedDiff([path]),
			selectedFilePaths: new Set([path]),
			fileDiffContents: new Map([[path, makeContent(path, "old", "new")]]),
		});

		const { factory, views } = makeStubFactory();
		render(<DiffView mergeViewFactory={factory} />);

		expect(views[0].config.gutter).toBe(true);
		expect(views[0].config.highlightChanges).toBe(false);
		expect(views[0].config.collapseUnchanged).toEqual({ margin: 3, minSize: 4 });
		expect(views[0].config.parent).toBeTruthy();
	});

	it("does not render the EDIT MODE banner when edit mode is off", () => {
		const path = "a.ts";
		useSelectionStore.setState({
			mergedDiff: makeMergedDiff([path]),
			selectedFilePaths: new Set([path]),
			fileDiffContents: new Map([[path, makeContent(path, "old", "new")]]),
		});
		render(<DiffView mergeViewFactory={makeStubFactory().factory} />);
		expect(screen.queryByText("EDIT MODE")).not.toBeInTheDocument();
	});

	it("renders the EDIT MODE banner when edit mode is on", () => {
		const path = "a.ts";
		useSelectionStore.setState({
			mergedDiff: makeMergedDiff([path]),
			selectedFilePaths: new Set([path]),
			fileDiffContents: new Map([[path, makeContent(path, "old", "new")]]),
		});
		useReviewStore.setState({ editMode: true });
		render(<DiffView mergeViewFactory={makeStubFactory().factory} />);
		expect(screen.getByText("EDIT MODE")).toBeInTheDocument();
	});

	it("dispatches a readOnly reconfigure on view.b when edit mode toggles", () => {
		const path = "a.ts";
		useSelectionStore.setState({
			mergedDiff: makeMergedDiff([path]),
			selectedFilePaths: new Set([path]),
			fileDiffContents: new Map([[path, makeContent(path, "old", "new")]]),
		});
		const { factory, views } = makeStubFactory();
		render(<DiffView mergeViewFactory={factory} />);

		const initialDispatchCount = views[0].b.dispatch.mock.calls.length;
		act(() => {
			useReviewStore.setState({ editMode: true });
		});

		expect(views[0].b.dispatch.mock.calls.length).toBeGreaterThan(initialDispatchCount);
	});

	it("auto-saves the b-side doc to the correct file path on edit-mode true → false", async () => {
		const path = "src/a.ts";
		useSelectionStore.setState({
			mergedDiff: makeMergedDiff([path]),
			selectedFilePaths: new Set([path]),
			fileDiffContents: new Map([[path, makeContent(path, "old", "original")]]),
		});
		useReviewStore.setState({ editMode: true });

		const { factory, views } = makeStubFactory();
		render(<DiffView mergeViewFactory={factory} />);

		// Find the b-side updateListener and fire it to flip the internal `edited` flag.
		const bExtensions = (views[0].config.b?.extensions ?? []) as unknown as ReadonlyArray<{
			facet?: unknown;
			value?: unknown;
		}>;
		const updateListener = bExtensions.find((e) => e.facet === EditorView.updateListener);
		expect(updateListener).toBeTruthy();
		act(() => {
			(updateListener!.value as (u: { docChanged: boolean }) => void)({ docChanged: true });
		});

		// Pretend the user typed: the b-side doc now reads back as a modified string.
		views[0].b.state.doc.toString = () => "MODIFIED";

		act(() => {
			useReviewStore.setState({ editMode: false });
		});

		await waitFor(() => {
			expect(getInvocationsFor("write_file_to_workdir")).toHaveLength(1);
		});
		const call = getInvocationsFor("write_file_to_workdir")[0];
		expect(call.args).toMatchObject({ path, content: "MODIFIED" });
	});

	it("Cmd+E toggles edit mode when a session is active", () => {
		const path = "a.ts";
		useSelectionStore.setState({
			mergedDiff: makeMergedDiff([path]),
			selectedFilePaths: new Set([path]),
			fileDiffContents: new Map([[path, makeContent(path, "old", "new")]]),
		});
		useReviewStore.setState({ isSessionActive: true, editMode: false });
		render(<DiffView mergeViewFactory={makeStubFactory().factory} />);
		fireEvent.keyDown(window, { key: "e", metaKey: true });
		expect(useReviewStore.getState().editMode).toBe(true);
	});

	it("Ctrl+E toggles edit mode (Windows/Linux fix)", () => {
		const path = "a.ts";
		useSelectionStore.setState({
			mergedDiff: makeMergedDiff([path]),
			selectedFilePaths: new Set([path]),
			fileDiffContents: new Map([[path, makeContent(path, "old", "new")]]),
		});
		useReviewStore.setState({ isSessionActive: true, editMode: false });
		render(<DiffView mergeViewFactory={makeStubFactory().factory} />);
		fireEvent.keyDown(window, { key: "e", ctrlKey: true });
		expect(useReviewStore.getState().editMode).toBe(true);
	});

	it("Cmd+E is a no-op when no session is active", () => {
		const path = "a.ts";
		useSelectionStore.setState({
			mergedDiff: makeMergedDiff([path]),
			selectedFilePaths: new Set([path]),
			fileDiffContents: new Map([[path, makeContent(path, "old", "new")]]),
		});
		useReviewStore.setState({ isSessionActive: false, editMode: false });
		render(<DiffView mergeViewFactory={makeStubFactory().factory} />);
		fireEvent.keyDown(window, { key: "e", metaKey: true });
		expect(useReviewStore.getState().editMode).toBe(false);
	});

	it("captures get_file_diff_content invocations during a multi-file scenario", async () => {
		const paths = ["a.ts", "b.ts"];
		setupMultiFileRepo({
			files: paths.map((p) => ({ path: p, oldContent: "old", newContent: "new" })),
		});
		useSelectionStore.setState({
			mergedDiff: makeMergedDiff(paths),
			selectedFilePaths: new Set(paths),
			fileDiffContents: new Map(paths.map((p) => [p, makeContent(p, "old", "new")])),
		});
		const { factory } = makeStubFactory();
		render(<DiffView mergeViewFactory={factory} />);
		// The mock infra is wired up; tests that drive the store via openRepository
		// would record fetches here. This smoke test asserts the capture array exists.
		expect(getInvocationsFor("get_file_diff_content")).toEqual([]);
	});
});
