import { useState, useCallback, useEffect } from "react";
import { Allotment } from "allotment";
import "allotment/dist/style.css";
import { Toolbar } from "./components/layout/Toolbar";
import { CommitList } from "./components/graph/CommitList";
import { FileList } from "./components/graph/FileList";
import { DiffView } from "./components/diff/DiffView";
import { CommentPanel } from "./components/review/CommentPanel";
import { useSelectionStore } from "./stores/selectionStore";
import { useReviewStore } from "./stores/reviewStore";
import { diag } from "./diagnostics";
import { useLogPath } from "./hooks/useLogPath";
import { useBugReportStore } from "./stores/bugReportStore";
import { BugReportOverlay } from "./components/bugreport/BugReportOverlay";

function App() {
	const error = useSelectionStore((s) => s.error);
	const [sidebarVisible, setSidebarVisible] = useState(true);
	const [reviewPanelVisible, setReviewPanelVisible] = useState(true);
	const toggleSidebar = useCallback(() => setSidebarVisible((v) => !v), []);
	const toggleReviewPanel = useCallback(() => setReviewPanelVisible((v) => !v), []);

	useEffect(() => {
		diag.appContext(window.screen.width, window.screen.height, navigator.language);
	}, []);

	return (
		<div className="flex flex-col h-screen bg-zinc-900 text-white">
			<Toolbar
				sidebarVisible={sidebarVisible}
				onToggleSidebar={toggleSidebar}
				reviewPanelVisible={reviewPanelVisible}
				onToggleReviewPanel={toggleReviewPanel}
			/>

			{error && (
				<div className="px-4 py-2 bg-red-900/50 text-red-300 text-sm border-b border-red-800">
					{error}
					<button
						onClick={() => useSelectionStore.setState({ error: null })}
						className="ml-2 text-red-400 hover:text-white"
					>
						Dismiss
					</button>
				</div>
			)}

			<div className="flex-1 min-h-0">
				<Allotment>
					{sidebarVisible && (
						<Allotment.Pane preferredSize={420} minSize={250}>
							<Allotment vertical>
								<Allotment.Pane preferredSize="60%">
									<CommitList />
								</Allotment.Pane>
								<Allotment.Pane>
									<FileList />
								</Allotment.Pane>
							</Allotment>
						</Allotment.Pane>
					)}

					<Allotment.Pane>
						<DiffView />
					</Allotment.Pane>

					{reviewPanelVisible && (
						<Allotment.Pane preferredSize={300} minSize={200}>
							<CommentPanel />
						</Allotment.Pane>
					)}
				</Allotment>
			</div>

			<StatusBar />
			<BugReportOverlay />
		</div>
	);
}

const IS_MAC =
	typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
const BUG_REPORT_SHORTCUT = IS_MAC ? "⌘⇧B" : "Ctrl+Shift+B";

function StatusBar() {
	const repoPath = useSelectionStore((s) => s.repoPath);
	const currentBranch = useSelectionStore((s) => s.currentBranch);
	const mergedDiff = useSelectionStore((s) => s.mergedDiff);
	const selectedFilePaths = useSelectionStore((s) => s.selectedFilePaths);
	const session = useReviewStore((s) => s.session);
	const editMode = useReviewStore((s) => s.editMode);
	const { showLogs } = useLogPath();
	const startBugReport = useBugReportStore((s) => s.enter);

	return (
			<div className="flex items-center px-4 py-1 bg-zinc-800 border-t border-zinc-700 text-xs text-zinc-500">
			{repoPath ? (
				<span className="flex items-center gap-2">
					{currentBranch && (
						<span className="flex items-center gap-1 text-zinc-300">
							<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
								<path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Z" />
							</svg>
							{currentBranch}
						</span>
					)}
					{session && (
						<span className="text-zinc-500">
							Review: {session.comments.length} comment{session.comments.length !== 1 ? "s" : ""}
						</span>
					)}
					{editMode && (
						<span className="text-amber-400">EDIT MODE</span>
					)}
				</span>
			) : (
				<span>No repository</span>
			)}
			<div className="flex-1" />
			{mergedDiff && (
				<span>
					{mergedDiff.files.length} file{mergedDiff.files.length !== 1 ? "s" : ""} changed
					{selectedFilePaths.size > 0 && selectedFilePaths.size < mergedDiff.files.length && (
						<span> ({selectedFilePaths.size} viewing)</span>
					)}
				</span>
			)}
			<button
				onClick={showLogs}
				className="ml-3 text-zinc-600 hover:text-zinc-400"
				title="Open log folder (for bug reports)"
			>
				Show Logs
			</button>
			<button
				onClick={() => void startBugReport()}
				className="ml-3 text-zinc-600 hover:text-red-400"
				title={`Report a bug (${BUG_REPORT_SHORTCUT})`}
				aria-label={`Report a bug (${BUG_REPORT_SHORTCUT})`}
			>
				<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
					<path d="M8 1.5a3 3 0 0 0-3 3v.328A4.5 4.5 0 0 0 3.5 8.5V10H1.75a.75.75 0 0 0 0 1.5H3.5v.5a4.5 4.5 0 0 0 9 0v-.5h1.75a.75.75 0 0 0 0-1.5H12.5V8.5a4.5 4.5 0 0 0-1.5-3.354V4.5a3 3 0 0 0-3-3Zm-1.5 3a1.5 1.5 0 1 1 3 0v.05a4.5 4.5 0 0 0-3 0V4.5ZM4 8.5h8V12a4 4 0 1 1-8 0V8.5Z" />
				</svg>
			</button>
		</div>
	);
}

export default App;
