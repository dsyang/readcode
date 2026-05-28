import { create } from "zustand";
import type { CommitInfo, CommitRange, FileDiffContent, MergedDiff } from "../api/types";
import { getCommits, getFileDiffContent, getMergedDiff, openRepo } from "../api/git";
import { disconnectRemote, openRemoteRepo } from "../api/remote";
import { useReviewStore } from "./reviewStore";
import { diag, startTimer, hashPath, classifyFrontendError } from "../diagnostics";

export type ConnectionMode = "local" | "remote";

export type RecentRepo =
	| { type: "local"; path: string }
	| { type: "remote"; sshHost: string; repoPath: string; profileName: string };

function recentRepoKey(r: RecentRepo): string {
	return r.type === "local" ? r.path : `${r.sshHost}:${r.repoPath}`;
}

const RECENT_REPOS_KEY = "readcode:recentRepos";
const MAX_RECENT_REPOS = 10;

interface SelectionState {
	// Repository
	repoPath: string | null;
	currentBranch: string | null;
	connectionMode: ConnectionMode | null;
	remoteProfileName: string | null;
	commits: CommitInfo[];
	isLoading: boolean;
	error: string | null;
	recentRepos: RecentRepo[];

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
	openRemoteRepository: (
		sshHost: string,
		repoPath: string,
		profileName: string,
	) => Promise<void>;
	reloadRepository: () => Promise<void>;
	reloadWorkingTree: () => void;
	closeRepository: () => void;
	removeRecentRepo: (entry: RecentRepo) => void;
	handleCommitClick: (oid: string, metaKey: boolean, shiftKey: boolean) => void;
	toggleWorkingTree: () => void;
	handleFileClick: (path: string, metaKey: boolean, shiftKey: boolean) => void;
	selectAllFiles: () => void;
	deselectAllFiles: () => void;
	clearSelection: () => void;
	restoreSelection: (commitOids: string[], includeWorkingTree: boolean) => void;
	ensureFileSelected: (filePath: string) => void;
	updateFileDiffContent: (filePath: string, newContent: string) => void;
	refreshCommits: () => Promise<void>;
}

function loadRecentRepos(): RecentRepo[] {
	try {
		const stored = localStorage.getItem(RECENT_REPOS_KEY);
		if (!stored) return [];
		const parsed = JSON.parse(stored);
		// Migrate old format (string[]) to new format
		if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === "string") {
			return parsed.map((p: string) => ({ type: "local" as const, path: p }));
		}
		return parsed;
	} catch {
		return [];
	}
}

function saveRecentRepos(repos: RecentRepo[]) {
	localStorage.setItem(RECENT_REPOS_KEY, JSON.stringify(repos));
}

function addToRecent(entry: RecentRepo, existing: RecentRepo[]): RecentRepo[] {
	const key = recentRepoKey(entry);
	const filtered = existing.filter((r) => recentRepoKey(r) !== key);
	return [entry, ...filtered].slice(0, MAX_RECENT_REPOS);
}

export const useSelectionStore = create<SelectionState>((set, get) => ({
	repoPath: null,
	currentBranch: null,
	connectionMode: null,
	remoteProfileName: null,
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

		diag.repoOpenAttempt();
		const elapsed = startTimer();

		set({
			isLoading: true,
			error: null,
			commits: [],
			selectedCommitOids: new Set(),
			lastClickedCommitOid: null,
			includeWorkingTree: false,
			mergedDiff: null,
			selectedFilePaths: new Set(),
			lastClickedFilePath: null,
			fileDiffContents: new Map(),
		});
		try {
			const info = await openRepo(path);
			const commits = await getCommits(50);
			const hashedId = await hashPath(path);
			diag.repoOpenSuccess(hashedId, commits.length, elapsed());
			const newRecent = addToRecent({ type: "local", path }, get().recentRepos);
			saveRecentRepos(newRecent);
			set({
				repoPath: info.workdir,
				currentBranch: info.current_branch,
				connectionMode: "local",
				remoteProfileName: null,
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
			diag.repoOpenFailure(classifyFrontendError(e));
			set({ isLoading: false, error: String(e) });
		}
	},

	openRemoteRepository: async (
		sshHost: string,
		repoPath: string,
		profileName: string,
	) => {
		useReviewStore.getState().clearSession();

		set({
			isLoading: true,
			error: null,
			commits: [],
			selectedCommitOids: new Set(),
			lastClickedCommitOid: null,
			includeWorkingTree: false,
			mergedDiff: null,
			selectedFilePaths: new Set(),
			lastClickedFilePath: null,
			fileDiffContents: new Map(),
		});
		try {
			const info = await openRemoteRepo(sshHost, repoPath);
			const commits = await getCommits(50);
			const newRecent = addToRecent(
				{ type: "remote", sshHost, repoPath, profileName },
				get().recentRepos,
			);
			saveRecentRepos(newRecent);
			set({
				repoPath: info.workdir,
				currentBranch: info.current_branch,
				connectionMode: "remote",
				remoteProfileName: profileName,
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
		} catch (e) {
			set({ isLoading: false, error: String(e) });
		}
	},

	reloadRepository: async () => {
		const state = get();
		if (!state.repoPath) return;
		set({ isLoading: true, error: null });
		try {
			// For local repos, re-open to refresh branch info.
			// For remote, the connection is already live — just refresh commits.
			if (state.connectionMode !== "remote") {
				const info = await openRepo(state.repoPath);
				set({ currentBranch: info.current_branch });
			}
			const commits = await getCommits(50);
			set({
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

	reloadWorkingTree: () => {
		const state = get();
		// Re-fetch the current diff and file contents, preserving selections.
		// Clears cached file contents so they're fetched fresh.
		set({ fileDiffContents: new Map() });
		fetchDiff(state.selectedCommitOids, state.includeWorkingTree, state.commits);
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
		diag.fileSelected(newSelection.size);
		fetchFileContents(newSelection, state);
	},

	closeRepository: () => {
		useReviewStore.getState().clearSession();
		const wasRemote = get().connectionMode === "remote";
		set({
			repoPath: null,
			currentBranch: null,
			connectionMode: null,
			remoteProfileName: null,
			commits: [],
			selectedCommitOids: new Set(),
			lastClickedCommitOid: null,
			includeWorkingTree: false,
			mergedDiff: null,
			selectedFilePaths: new Set(),
			lastClickedFilePath: null,
			fileDiffContents: new Map(),
		});
		if (wasRemote) {
			disconnectRemote().catch(() => {});
		}
	},

	removeRecentRepo: (entry: RecentRepo) => {
		const key = recentRepoKey(entry);
		const newRecent = get().recentRepos.filter((r) => recentRepoKey(r) !== key);
		saveRecentRepos(newRecent);
		set({ recentRepos: newRecent });
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

	restoreSelection: (commitOids: string[], includeWorkingTree: boolean) => {
		const state = get();
		const newSelection = new Set(
			commitOids.filter((oid) => state.commits.some((c) => c.oid === oid)),
		);
		set({
			selectedCommitOids: newSelection,
			includeWorkingTree,
			lastClickedCommitOid: null,
		});
		fetchDiff(newSelection, includeWorkingTree, state.commits);
	},

	ensureFileSelected: (filePath: string) => {
		const state = get();
		if (state.selectedFilePaths.has(filePath)) return;
		const newPaths = new Set(state.selectedFilePaths);
		newPaths.add(filePath);
		set({ selectedFilePaths: newPaths });
		fetchFileContents(newPaths, { ...state, selectedFilePaths: newPaths });
	},

	// Keep the cached diff content in sync with manual edits so reselecting a
	// file after editing still shows the edited content (the backend reads
	// content from the commit, not the working tree).
	updateFileDiffContent: (filePath: string, newContent: string) => {
		const state = get();
		const existing = state.fileDiffContents.get(filePath);
		if (!existing) return;
		const newMap = new Map(state.fileDiffContents);
		newMap.set(filePath, { ...existing, new_content: newContent });
		set({ fileDiffContents: newMap });
	},

	refreshCommits: async () => {
		const state = get();
		if (!state.repoPath) return;
		try {
			const commits = await getCommits(50);
			set({ commits });
		} catch (e) {
			set({ error: String(e) });
		}
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
	const elapsed = startTimer();
	useSelectionStore.setState({ isDiffLoading: true });
	try {
		const diff = await getMergedDiff(range);
		const totalLines = diff.files.reduce((sum, f) => sum + f.additions + f.deletions, 0);
		diag.diffLoaded(selectedOids.size, diff.files.length, totalLines, elapsed());
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
		diag.ipcError("get_merged_diff", classifyFrontendError(e));
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
		// Keep cached entries for deselected files. Manual edits made in the
		// editor are saved to disk and reflected back into this cache, but the
		// backend's get_file_diff_content reads from the commit rather than
		// the working tree — so dropping the cache on deselect and refetching
		// on reselect would silently revert the edits in the diff view.
		useSelectionStore.setState({ fileDiffContents: newMap, isDiffLoading: false });
	} catch (e) {
		useSelectionStore.setState({ isDiffLoading: false, error: String(e) });
	}
}
