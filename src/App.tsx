import { Allotment } from "allotment";
import "allotment/dist/style.css";
import { Toolbar } from "./components/layout/Toolbar";
import { CommitList } from "./components/graph/CommitList";
import { FileList } from "./components/graph/FileList";
import { DiffView } from "./components/diff/DiffView";
import { useSelectionStore } from "./stores/selectionStore";

function App() {
	const error = useSelectionStore((s) => s.error);

	return (
		<div className="flex flex-col h-screen bg-zinc-900 text-white">
			<Toolbar />

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
					{/* Left panel: commits + file list */}
					<Allotment.Pane preferredSize={320} minSize={200}>
						<Allotment vertical>
							<Allotment.Pane preferredSize="60%">
								<CommitList />
							</Allotment.Pane>
							<Allotment.Pane>
								<FileList />
							</Allotment.Pane>
						</Allotment>
					</Allotment.Pane>

					{/* Center panel: diff viewer */}
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
	const mergedDiff = useSelectionStore((s) => s.mergedDiff);

	return (
		<div className="flex items-center px-4 py-1 bg-zinc-800 border-t border-zinc-700 text-xs text-zinc-500">
			<span>{repoPath ? "Connected" : "No repository"}</span>
			<div className="flex-1" />
			{mergedDiff && (
				<span>
					Diff: {mergedDiff.head_description} &mdash;{" "}
					{mergedDiff.files.length} file{mergedDiff.files.length !== 1 ? "s" : ""}
				</span>
			)}
		</div>
	);
}

export default App;
