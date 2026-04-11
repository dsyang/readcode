import { useState, useCallback } from "react";
import { Allotment } from "allotment";
import "allotment/dist/style.css";
import { Toolbar } from "./components/layout/Toolbar";
import { CommitList } from "./components/graph/CommitList";
import { FileList } from "./components/graph/FileList";
import { DiffView } from "./components/diff/DiffView";
import { useSelectionStore } from "./stores/selectionStore";

function App() {
	const error = useSelectionStore((s) => s.error);
	const [sidebarVisible, setSidebarVisible] = useState(true);
	const toggleSidebar = useCallback(() => setSidebarVisible((v) => !v), []);

	return (
		<div className="flex flex-col h-screen bg-zinc-900 text-white">
			<Toolbar sidebarVisible={sidebarVisible} onToggleSidebar={toggleSidebar} />

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
				</Allotment>
			</div>

			<StatusBar />
		</div>
	);
}

function StatusBar() {
	const repoPath = useSelectionStore((s) => s.repoPath);
	const currentBranch = useSelectionStore((s) => s.currentBranch);
	const mergedDiff = useSelectionStore((s) => s.mergedDiff);
	const selectedFilePaths = useSelectionStore((s) => s.selectedFilePaths);

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
		</div>
	);
}

export default App;
