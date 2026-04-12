import { create } from "zustand";
import type { CommitInfo, CommitRange, FileDiffContent, MergedDiff } from "../api/types";
import { getCommits, getFileDiffContent, getMergedDiff, openRepo } from "../api/git";
import { useReviewStore } from "./reviewStore";

const RECENT_REPOS_KEY = "readcode:recentRepos";
const MAX_RECENT_REPOS = 10;

interface SelectionState {
	// Repository
	repoPath: string | null;
	currentBranch: string | null;
	commits: CommitInfo[];
	isLoading: boolean;
	error: string | null;
	recentRepos: string[];

	// Commit selection
	selectedCommitOids: Set<string>;
	lastClickedCommitOid: string | null;
	includeWorkingTree: boolean;

	// Diff
	mergedDiff: MergedDiff | null;

	// File selection (multi-select)
	selectedFilePaths: Set<string>;
	lastClickedFilePath: string | null;
	fileDiffContents: Map<string, FileDiffContent>;
	isDiffLoading: boolean;

	// Actions
	openRepository: (path: string) => Promise<void>;
	reloadRepository: () => Promise<void>;
	closeRepository: () => void;
	handleCommitClick: (oid: string, metaKey: boolean, shiftKey: boolean) => void;
	toggleWorkingTree: () => void;
	handleFileClick: (path: string, metaKey: boolean, shiftKey: boolean) => void;
	selectAllFiles: () => void;
	deselectAllFiles: () => void;
	clearSelection: () => void;
}

function loadRecentRepos(): string[] {
	try {
		const stored = localStorage.getItem(RECENT_REPOS_KEY);
		return stored ? JSON.parse(stored) : [];
	} catch {
		return [];
	}
}

function saveRecentRepos(repos: string[]) {
	localStorage.setItem(RECENT_REPOS_KEY, JSON.stringify(repos));
}

function addToRecent(path: string, existing: string[]): string[] {
	const filtered = existing.filter((r) => r !== path);
	return [path, ...filtered].slice(0, MAX_RECENT_REPOS);
}

export const useSelectionStore = create<SelectionState>((set, get) => ({
	repoPath: null,
	currentBranch: null,
	commits: [],
	isLoading: false,
	error: null,
	recentRepos: loadRecentRepos(),

	selectedCommitOids: new Set(),
	lastClickedCommitOid: null,
	includeWorkingTree: false,

	mergedDiff: null,
	selectedFilePaths: new Set(),
	lastClickedFilePath: null,
	fileDiffContents: new Map(),
	isDiffLoading: false,

	openRepository: async (path: string) => {
		// Clear any active review when switching repos
		useReviewStore.getState().clearSession();

		set({ isLoading: true, error: null });
		try {
			const info = await openRepo(path);
			const commits = await getCommits(50);
			const newRecent = addToRecent(path, get().recentRepos);
			saveRecentRepos(newRecent);
			set({
				repoPath: info.workdir,
				currentBranch: info.current_branch,
				commits,
				isLoading: false,
				recentRepos: newRecent,
				selectedCommitOids: new Set(),
				lastClickedCommitOid: null,
				includeWorkingTree: false,
				mergedDiff: null,
				selectedFilePaths: new Set(),
				lastClickedFilePath: null,
				fileDiffContents: new Map(),
			});

			// Check for existing active sessions in the new repo
			useReviewStore.getState().checkExistingSessions();
		} catch (e) {
			set({ isLoading: false, error: String(e) });
		}
	},

	reloadRepository: async () => {
		const state = get();
		if (!state.repoPath) return;
		set({ isLoading: true, error: null });
		try {
			const info = await openRepo(state.repoPath);
			const commits = await getCommits(50);
			set({
				currentBranch: info.current_branch,
				commits,
				isLoading: false,
				selectedCommitOids: new Set(),
				lastClickedCommitOid: null,
				includeWorkingTree: false,
				mergedDiff: null,
				selectedFilePaths: new Set(),
				lastClickedFilePath: null,
				fileDiffContents: new Map(),
			});
		} catch (e) {
			set({ isLoading: false, error: String(e) });
		}
	},

	handleCommitClick: (oid: string, metaKey: boolean, shiftKey: boolean) => {
		const state = get();
		let newSelection: Set<string>;

		if (shiftKey && state.lastClickedCommitOid) {
			// Shift+click: range select from last clicked to this one
			const commitOids = state.commits.map((c) => c.oid);
			const lastIdx = commitOids.indexOf(state.lastClickedCommitOid);
			const currentIdx = commitOids.indexOf(oid);
			if (lastIdx !== -1 && currentIdx !== -1) {
				const [start, end] = lastIdx < currentIdx
					? [lastIdx, currentIdx]
					: [currentIdx, lastIdx];
				// If Ctrl is also held, add to existing; otherwise replace
				newSelection = metaKey ? new Set(state.selectedCommitOids) : new Set();
				for (let i = start; i <= end; i++) {
					newSelection.add(commitOids[i]);
				}
			} else {
				newSelection = new Set([oid]);
			}
		} else if (metaKey) {
			// Ctrl/Cmd+click: toggle individual
			newSelection = new Set(state.selectedCommitOids);
			if (newSelection.has(oid)) {
				newSelection.delete(oid);
			} else {
				newSelection.add(oid);
			}
		} else {
			// Plain click: select only this one
			newSelection = new Set([oid]);
		}

		set({ selectedCommitOids: newSelection, lastClickedCommitOid: oid });
		fetchDiff(newSelection, state.includeWorkingTree, state.commits);
	},

	toggleWorkingTree: () => {
		const state = get();
		const newValue = !state.includeWorkingTree;
		set({ includeWorkingTree: newValue });
		fetchDiff(state.selectedCommitOids, newValue, state.commits);
	},

	handleFileClick: (path: string, metaKey: boolean, shiftKey: boolean) => {
		const state = get();
		if (!state.mergedDiff) return;

		const allPaths = state.mergedDiff.files.map((f) => f.path);
		let newSelection: Set<string>;

		if (shiftKey && state.lastClickedFilePath) {
			const lastIdx = allPaths.indexOf(state.lastClickedFilePath);
			const currentIdx = allPaths.indexOf(path);
			if (lastIdx !== -1 && currentIdx !== -1) {
				const [start, end] = lastIdx < currentIdx
					? [lastIdx, currentIdx]
					: [currentIdx, lastIdx];
				newSelection = metaKey ? new Set(state.selectedFilePaths) : new Set();
				for (let i = start; i <= end; i++) {
					newSelection.add(allPaths[i]);
				}
			} else {
				newSelection = new Set([path]);
			}
		} else if (metaKey) {
			newSelection = new Set(state.selectedFilePaths);
			if (newSelection.has(path)) {
				newSelection.delete(path);
			} else {
				newSelection.add(path);
			}
		} else {
			newSelection = new Set([path]);
		}

		set({ selectedFilePaths: newSelection, lastClickedFilePath: path });
		fetchFileContents(newSelection, state);
	},

	closeRepository: () => {
		useReviewStore.getState().clearSession();
		set({
			repoPath: null,
			currentBranch: null,
			commits: [],
			selectedCommitOids: new Set(),
			lastClickedCommitOid: null,
			includeWorkingTree: false,
			mergedDiff: null,
			selectedFilePaths: new Set(),
			lastClickedFilePath: null,
			fileDiffContents: new Map(),
		});
	},

	selectAllFiles: () => {
		const state = get();
		if (!state.mergedDiff) return;
		const allPaths = new Set(state.mergedDiff.files.map((f) => f.path));
		set({ selectedFilePaths: allPaths });
		fetchFileContents(allPaths, state);
	},

	deselectAllFiles: () => {
		set({ selectedFilePaths: new Set(), fileDiffContents: new Map() });
	},

	clearSelection: () => {
		set({
			selectedCommitOids: new Set(),
			lastClickedCommitOid: null,
			includeWorkingTree: false,
			mergedDiff: null,
			selectedFilePaths: new Set(),
			lastClickedFilePath: null,
			fileDiffContents: new Map(),
		});
	},
}));

function buildRange(
	selectedOids: Set<string>,
	includeWorkingTree: boolean,
	allCommits: CommitInfo[],
): CommitRange {
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
			selectedFilePaths: new Set(),
			lastClickedFilePath: null,
			fileDiffContents: new Map(),
		});
		return;
	}

	const range = buildRange(selectedOids, includeWorkingTree, allCommits);
	useSelectionStore.setState({ isDiffLoading: true });
	try {
		const diff = await getMergedDiff(range);
		// Default: select all files
		const allPaths = new Set(diff.files.map((f) => f.path));
		useSelectionStore.setState({
			mergedDiff: diff,
			isDiffLoading: false,
			selectedFilePaths: allPaths,
			lastClickedFilePath: null,
			fileDiffContents: new Map(),
		});
		// Fetch contents for all files
		const state = useSelectionStore.getState();
		fetchFileContents(allPaths, state);
	} catch (e) {
		useSelectionStore.setState({ isDiffLoading: false, error: String(e) });
	}
}

async function fetchFileContents(
	selectedPaths: Set<string>,
	state: SelectionState,
) {
	if (selectedPaths.size === 0) {
		useSelectionStore.setState({ fileDiffContents: new Map() });
		return;
	}

	const range = buildRange(
		state.selectedCommitOids,
		state.includeWorkingTree,
		state.commits,
	);

	useSelectionStore.setState({ isDiffLoading: true });

	// Reuse already-loaded content, fetch only missing
	const existing = state.fileDiffContents;
	const toFetch = Array.from(selectedPaths).filter((p) => !existing.has(p));

	try {
		const results = await Promise.all(
			toFetch.map((path) => getFileDiffContent(path, range)),
		);
		const newMap = new Map(existing);
		for (const result of results) {
			newMap.set(result.path, result);
		}
		// Remove deselected
		for (const key of newMap.keys()) {
			if (!selectedPaths.has(key)) {
				newMap.delete(key);
			}
		}
		useSelectionStore.setState({ fileDiffContents: newMap, isDiffLoading: false });
	} catch (e) {
		useSelectionStore.setState({ isDiffLoading: false, error: String(e) });
	}
}
