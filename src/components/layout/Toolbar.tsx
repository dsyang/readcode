import { useState, useRef, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useSelectionStore } from "../../stores/selectionStore";
import { useReviewStore } from "../../stores/reviewStore";

interface ToolbarProps {
	sidebarVisible: boolean;
	onToggleSidebar: () => void;
	reviewPanelVisible: boolean;
	onToggleReviewPanel: () => void;
}

export function Toolbar({ sidebarVisible, onToggleSidebar, reviewPanelVisible, onToggleReviewPanel }: ToolbarProps) {
	const repoPath = useSelectionStore((s) => s.repoPath);
	const isLoading = useSelectionStore((s) => s.isLoading);
	const rawOpenRepository = useSelectionStore((s) => s.openRepository);
	const closeRepository = useSelectionStore((s) => s.closeRepository);
	const reloadRepository = useSelectionStore((s) => s.reloadRepository);
	const recentRepos = useSelectionStore((s) => s.recentRepos);
	const clearSession = useReviewStore((s) => s.clearSession);
	const checkExistingSessions = useReviewStore((s) => s.checkExistingSessions);
	const [showDropdown, setShowDropdown] = useState(false);
	const dropdownRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		function handleClickOutside(e: MouseEvent) {
			if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
				setShowDropdown(false);
			}
		}
		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, []);

	async function openRepository(path: string) {
		clearSession();
		await rawOpenRepository(path);
		setTimeout(() => checkExistingSessions(), 50);
	}

	async function handleOpenRepo() {
		setShowDropdown(false);
		const selected = await open({ directory: true, multiple: false });
		if (selected) {
			await openRepository(selected);
		}
	}

	function handleOpenRecent(path: string) {
		setShowDropdown(false);
		openRepository(path);
	}

	function handleClose() {
		setShowDropdown(false);
		clearSession();
		closeRepository();
	}

	const repoName = repoPath
		? repoPath.replace(/\/$/, "").split("/").pop()
		: null;

	const hasDropdown = repoPath || recentRepos.length > 0;

	return (
		<div className="flex items-center gap-2 px-4 py-2 bg-zinc-900 border-b border-zinc-700 text-sm">
			{/* Left side: sidebar toggle + repo button + reload */}
			<button
				onClick={onToggleSidebar}
				className="p-1 text-zinc-400 hover:text-white rounded hover:bg-zinc-700"
				title={sidebarVisible ? "Hide sidebar" : "Show sidebar"}
			>
				<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
					<rect x="1" y="2" width="14" height="12" rx="1.5" />
					<line x1="5.5" y1="2" x2="5.5" y2="14" />
					{!sidebarVisible && (
						<>
							<line x1="3" y1="5" x2="3" y2="11" strokeWidth="1" strokeOpacity="0.5" />
							<line x1="3" y1="8" x2="5" y2="8" strokeWidth="1" strokeOpacity="0.5" />
						</>
					)}
				</svg>
			</button>

			<div className="relative" ref={dropdownRef}>
				<div className="flex">
					{repoPath ? (
						<button
							onClick={() => setShowDropdown(!showDropdown)}
							disabled={isLoading}
							className="flex items-center gap-1.5 px-3 py-1 bg-zinc-700 hover:bg-zinc-600 disabled:bg-zinc-600 rounded text-white font-medium"
						>
							{repoName}
							<span className="text-[10px] text-zinc-400">&#9660;</span>
						</button>
					) : (
						<>
							<button
								onClick={handleOpenRepo}
								disabled={isLoading}
								className={`px-3 py-1 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-600 text-white font-medium ${
									hasDropdown ? "rounded-l" : "rounded"
								}`}
							>
								Open Repo
							</button>
							{hasDropdown && (
								<button
									onClick={() => setShowDropdown(!showDropdown)}
									className="px-1.5 py-1 bg-blue-600 hover:bg-blue-500 rounded-r border-l border-blue-500 text-white"
								>
									<span className="text-[10px]">&#9660;</span>
								</button>
							)}
						</>
					)}
				</div>

				{showDropdown && (
					<div className="absolute top-full left-0 mt-1 w-80 bg-zinc-800 border border-zinc-600 rounded shadow-xl z-50">
						{repoPath && (
							<>
								<button
									onClick={handleOpenRepo}
									className="w-full text-left px-3 py-2 hover:bg-zinc-700 text-sm text-zinc-200 border-b border-zinc-700"
								>
									Open Different Repo...
								</button>
								<button
									onClick={handleClose}
									className="w-full text-left px-3 py-2 hover:bg-zinc-700 text-sm text-zinc-400 border-b border-zinc-700"
								>
									Close Repository
								</button>
							</>
						)}
						{recentRepos.length > 0 && (
							<>
								<div className="px-3 py-1.5 text-xs text-zinc-500">
									Recent
								</div>
								{recentRepos.map((path) => {
									const name = path.replace(/\/$/, "").split("/").pop();
									const isCurrent = path === repoPath;
									return (
										<button
											key={path}
											onClick={() => handleOpenRecent(path)}
											className={`w-full text-left px-3 py-1.5 hover:bg-zinc-700 text-sm ${
												isCurrent ? "bg-zinc-700/50" : ""
											}`}
										>
											<div className="flex items-center gap-2">
												<span className="text-zinc-200">{name}</span>
												{isCurrent && (
													<span className="text-[10px] text-zinc-500">current</span>
												)}
											</div>
											<div className="text-xs text-zinc-500 truncate">{path}</div>
										</button>
									);
								})}
							</>
						)}
					</div>
				)}
			</div>

			{repoPath && (
				<button
					onClick={reloadRepository}
					disabled={isLoading}
					className="p-1 text-zinc-400 hover:text-white rounded hover:bg-zinc-700 disabled:opacity-50"
					title="Reload repository"
				>
					<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
						<path d="M2.5 8a5.5 5.5 0 0 1 9.3-4" />
						<path d="M13.5 8a5.5 5.5 0 0 1-9.3 4" />
						<polyline points="12 2 12 5 9 5" fill="none" />
						<polyline points="4 14 4 11 7 11" fill="none" />
					</svg>
				</button>
			)}

			<div className="flex-1" />

			{/* Right side: review panel toggle */}
			<button
				onClick={onToggleReviewPanel}
				className="p-1 text-zinc-400 hover:text-white rounded hover:bg-zinc-700"
				title={reviewPanelVisible ? "Hide review panel" : "Show review panel"}
			>
				<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
					<rect x="1" y="2" width="14" height="12" rx="1.5" />
					<line x1="10.5" y1="2" x2="10.5" y2="14" />
					{!reviewPanelVisible && (
						<>
							<line x1="12" y1="5" x2="12" y2="11" strokeWidth="1" strokeOpacity="0.5" />
							<line x1="11" y1="8" x2="13" y2="8" strokeWidth="1" strokeOpacity="0.5" />
						</>
					)}
				</svg>
			</button>
		</div>
	);
}
