import { create } from "zustand";
import type { CommitInfo, CommitRange, FileDiffContent, MergedDiff } from "../api/types";
import { getCommits, getFileDiffContent, getMergedDiff, openRepo } from "../api/git";

interface SelectionState {
	// Repository
	repoPath: string | null;
	commits: CommitInfo[];
	isLoading: boolean;
	error: string | null;

	// Selection
	selectedCommitOids: Set<string>;
	includeWorkingTree: boolean;

	// Diff
	mergedDiff: MergedDiff | null;
	selectedFilePath: string | null;
	fileDiffContent: FileDiffContent | null;
	isDiffLoading: boolean;

	// Actions
	openRepository: (path: string) => Promise<void>;
	toggleCommitSelection: (oid: string, shiftKey: boolean) => void;
	toggleWorkingTree: () => void;
	selectFile: (path: string) => Promise<void>;
	clearSelection: () => void;
}

export const useSelectionStore = create<SelectionState>((set, get) => ({
	repoPath: null,
	commits: [],
	isLoading: false,
	error: null,

	selectedCommitOids: new Set(),
	includeWorkingTree: false,

	mergedDiff: null,
	selectedFilePath: null,
	fileDiffContent: null,
	isDiffLoading: false,

	openRepository: async (path: string) => {
		set({ isLoading: true, error: null });
		try {
			const workdir = await openRepo(path);
			const commits = await getCommits(500);
			set({
				repoPath: workdir,
				commits,
				isLoading: false,
				selectedCommitOids: new Set(),
				includeWorkingTree: false,
				mergedDiff: null,
				selectedFilePath: null,
				fileDiffContent: null,
			});
		} catch (e) {
			set({ isLoading: false, error: String(e) });
		}
	},

	toggleCommitSelection: (oid: string, shiftKey: boolean) => {
		const state = get();
		const newSelection = new Set(state.selectedCommitOids);

		if (shiftKey && newSelection.size > 0) {
			// Range selection: select all commits between the last selected and this one
			const commitOids = state.commits.map((c) => c.oid);
			const lastSelected = Array.from(newSelection).pop()!;
			const lastIdx = commitOids.indexOf(lastSelected);
			const currentIdx = commitOids.indexOf(oid);
			if (lastIdx !== -1 && currentIdx !== -1) {
				const [start, end] = lastIdx < currentIdx
					? [lastIdx, currentIdx]
					: [currentIdx, lastIdx];
				for (let i = start; i <= end; i++) {
					newSelection.add(commitOids[i]);
				}
			}
		} else {
			if (newSelection.has(oid)) {
				newSelection.delete(oid);
			} else {
				newSelection.add(oid);
			}
		}

		set({ selectedCommitOids: newSelection });
		fetchDiff(newSelection, state.includeWorkingTree, state.commits);
	},

	toggleWorkingTree: () => {
		const state = get();
		const newValue = !state.includeWorkingTree;
		set({ includeWorkingTree: newValue });
		fetchDiff(state.selectedCommitOids, newValue, state.commits);
	},

	selectFile: async (path: string) => {
		const state = get();
		set({ selectedFilePath: path, isDiffLoading: true });
		try {
			const range = buildRange(state.selectedCommitOids, state.includeWorkingTree, state.commits);
			const content = await getFileDiffContent(path, range);
			set({ fileDiffContent: content, isDiffLoading: false });
		} catch (e) {
			set({ isDiffLoading: false, error: String(e) });
		}
	},

	clearSelection: () => {
		set({
			selectedCommitOids: new Set(),
			includeWorkingTree: false,
			mergedDiff: null,
			selectedFilePath: null,
			fileDiffContent: null,
		});
	},
}));

function buildRange(
	selectedOids: Set<string>,
	includeWorkingTree: boolean,
	allCommits: CommitInfo[],
): CommitRange {
	// Order selected commits topologically (same order as allCommits, which is newest-first)
	// We need oldest-first for the range
	const ordered = allCommits
		.filter((c) => selectedOids.has(c.oid))
		.reverse()
		.map((c) => c.oid);
	return { commits: ordered, include_working_tree: includeWorkingTree };
}

async function fetchDiff(
	selectedOids: Set<string>,
	includeWorkingTree: boolean,
	allCommits: CommitInfo[],
) {
	if (selectedOids.size === 0 && !includeWorkingTree) {
		useSelectionStore.setState({
			mergedDiff: null,
			selectedFilePath: null,
			fileDiffContent: null,
		});
		return;
	}

	const range = buildRange(selectedOids, includeWorkingTree, allCommits);
	useSelectionStore.setState({ isDiffLoading: true });
	try {
		const diff = await getMergedDiff(range);
		useSelectionStore.setState({
			mergedDiff: diff,
			isDiffLoading: false,
			selectedFilePath: null,
			fileDiffContent: null,
		});
	} catch (e) {
		useSelectionStore.setState({ isDiffLoading: false, error: String(e) });
	}
}
