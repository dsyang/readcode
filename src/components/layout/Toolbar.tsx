import { open } from "@tauri-apps/plugin-dialog";
import { useSelectionStore } from "../../stores/selectionStore";

export function Toolbar() {
	const repoPath = useSelectionStore((s) => s.repoPath);
	const isLoading = useSelectionStore((s) => s.isLoading);
	const includeWorkingTree = useSelectionStore((s) => s.includeWorkingTree);
	const selectedCount = useSelectionStore((s) => s.selectedCommitOids.size);
	const toggleWorkingTree = useSelectionStore((s) => s.toggleWorkingTree);
	const clearSelection = useSelectionStore((s) => s.clearSelection);
	const openRepository = useSelectionStore((s) => s.openRepository);

	async function handleOpenRepo() {
		const selected = await open({ directory: true, multiple: false });
		if (selected) {
			await openRepository(selected);
		}
	}

	return (
		<div className="flex items-center gap-3 px-4 py-2 bg-zinc-900 border-b border-zinc-700 text-sm">
			<button
				onClick={handleOpenRepo}
				disabled={isLoading}
				className="px-3 py-1 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-600 rounded text-white font-medium"
			>
				Open Repo
			</button>

			{repoPath && (
				<span className="text-zinc-400 truncate max-w-xs" title={repoPath}>
					{repoPath}
				</span>
			)}

			<div className="flex-1" />

			{repoPath && (
				<>
					<label className="flex items-center gap-2 text-zinc-300 cursor-pointer">
						<input
							type="checkbox"
							checked={includeWorkingTree}
							onChange={toggleWorkingTree}
							className="accent-blue-500"
						/>
						Working Tree
					</label>

					{selectedCount > 0 && (
						<span className="text-zinc-400">
							{selectedCount} commit{selectedCount > 1 ? "s" : ""} selected
						</span>
					)}

					<button
						onClick={clearSelection}
						className="px-2 py-1 text-zinc-400 hover:text-white"
					>
						Clear
					</button>
				</>
			)}
		</div>
	);
}
