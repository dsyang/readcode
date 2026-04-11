import { useState, useRef, useEffect } from "react";
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
	const recentRepos = useSelectionStore((s) => s.recentRepos);
	const [showRecent, setShowRecent] = useState(false);
	const dropdownRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		function handleClickOutside(e: MouseEvent) {
			if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
				setShowRecent(false);
			}
		}
		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, []);

	async function handleOpenRepo() {
		const selected = await open({ directory: true, multiple: false });
		if (selected) {
			await openRepository(selected);
		}
	}

	function handleOpenRecent(path: string) {
		setShowRecent(false);
		openRepository(path);
	}

	const repoName = repoPath
		? repoPath.replace(/\/$/, "").split("/").pop()
		: null;

	return (
		<div className="flex items-center gap-3 px-4 py-2 bg-zinc-900 border-b border-zinc-700 text-sm">
			<div className="relative" ref={dropdownRef}>
				<div className="flex">
					<button
						onClick={handleOpenRepo}
						disabled={isLoading}
						className={`px-3 py-1 ${
							repoPath ? "bg-zinc-700 hover:bg-zinc-600" : "bg-blue-600 hover:bg-blue-500"
						} disabled:bg-zinc-600 rounded-l text-white font-medium`}
					>
						{repoPath ? repoName : "Open Repo"}
					</button>
					{recentRepos.length > 0 && (
						<button
							onClick={() => setShowRecent(!showRecent)}
							className={`px-1.5 py-1 ${
								repoPath ? "bg-zinc-700 hover:bg-zinc-600" : "bg-blue-600 hover:bg-blue-500"
							} rounded-r border-l border-zinc-600 text-white`}
						>
							<span className="text-xs">&#9660;</span>
						</button>
					)}
				</div>

				{showRecent && (
					<div className="absolute top-full left-0 mt-1 w-80 bg-zinc-800 border border-zinc-600 rounded shadow-xl z-50">
						<div className="px-3 py-1.5 text-xs text-zinc-500 border-b border-zinc-700">
							Recent Repositories
						</div>
						{recentRepos.map((path) => {
							const name = path.replace(/\/$/, "").split("/").pop();
							return (
								<button
									key={path}
									onClick={() => handleOpenRecent(path)}
									className="w-full text-left px-3 py-1.5 hover:bg-zinc-700 text-sm"
								>
									<div className="text-zinc-200">{name}</div>
									<div className="text-xs text-zinc-500 truncate">{path}</div>
								</button>
							);
						})}
					</div>
				)}
			</div>

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
