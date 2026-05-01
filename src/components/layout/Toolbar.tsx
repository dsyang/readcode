import { useState, useRef, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useSelectionStore, type RecentRepo } from "../../stores/selectionStore";
import { useReviewStore } from "../../stores/reviewStore";
import { useUpdater } from "../../hooks/useUpdater";
import { ConnectionDialog } from "../remote/ConnectionDialog";

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
	const removeRecentRepo = useSelectionStore((s) => s.removeRecentRepo);
	const clearSession = useReviewStore((s) => s.clearSession);
	const checkExistingSessions = useReviewStore((s) => s.checkExistingSessions);
	const connectionMode = useSelectionStore((s) => s.connectionMode);
	const remoteProfileName = useSelectionStore((s) => s.remoteProfileName);
	const [showDropdown, setShowDropdown] = useState(false);
	const [showRemoteDialog, setShowRemoteDialog] = useState(false);
	const dropdownRef = useRef<HTMLDivElement>(null);
	const { updateAvailable, updateVersion, installing, installUpdate } = useUpdater();

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

	const openRemoteRepository = useSelectionStore((s) => s.openRemoteRepository);

	function handleOpenRecent(entry: RecentRepo) {
		setShowDropdown(false);
		if (entry.type === "local") {
			openRepository(entry.path);
		} else {
			clearSession();
			openRemoteRepository(entry.sshHost, entry.repoPath, entry.profileName);
		}
	}

	function handleClose() {
		setShowDropdown(false);
		clearSession();
		closeRepository();
	}

	const repoName = repoPath
		? repoPath.replace(/\/$/, "").split("/").pop()
		: null;

	const hasDropdown = true;

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
					{isLoading ? (
						<button
							disabled
							className="flex items-center gap-1.5 px-3 py-1 bg-zinc-700 rounded text-zinc-400 font-medium"
						>
							<svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
								<circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
								<path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
							</svg>
							Loading...
						</button>
					) : repoPath ? (
						<button
							onClick={() => setShowDropdown(!showDropdown)}
							className="flex items-center gap-1.5 px-3 py-1 bg-zinc-700 hover:bg-zinc-600 rounded text-white font-medium"
						>
							{connectionMode === "remote" && (
								<span
									className="text-[10px] px-1.5 py-0.5 bg-emerald-700/70 text-emerald-100 rounded"
									title={remoteProfileName ?? "Remote connection"}
								>
									REMOTE
								</span>
							)}
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
									onClick={() => {
										setShowDropdown(false);
										setShowRemoteDialog(true);
									}}
									className="w-full text-left px-3 py-2 hover:bg-zinc-700 text-sm text-zinc-200 border-b border-zinc-700"
								>
									Connect to Remote...
								</button>
								<button
									onClick={handleClose}
									className="w-full text-left px-3 py-2 hover:bg-zinc-700 text-sm text-zinc-400 border-b border-zinc-700"
								>
									{connectionMode === "remote" ? "Disconnect" : "Close Repository"}
								</button>
							</>
						)}
						{!repoPath && (
							<button
								onClick={() => {
									setShowDropdown(false);
									setShowRemoteDialog(true);
								}}
								className="w-full text-left px-3 py-2 hover:bg-zinc-700 text-sm text-zinc-200 border-b border-zinc-700"
							>
								Connect to Remote...
							</button>
						)}
						{recentRepos.length > 0 && (
							<>
								<div className="px-3 py-1.5 text-xs text-zinc-500">
									Recent
								</div>
								{recentRepos.map((entry) => {
									const key = entry.type === "local" ? entry.path : `${entry.sshHost}:${entry.repoPath}`;
									const name = entry.type === "local"
										? entry.path.replace(/\/$/, "").split("/").pop()
										: entry.repoPath.replace(/\/$/, "").split("/").pop();
									const subtitle = entry.type === "local"
										? entry.path
										: `${entry.sshHost}:${entry.repoPath}`;
									const isCurrent = entry.type === "local"
										? entry.path === repoPath
										: connectionMode === "remote" && subtitle.endsWith(repoPath ?? "");
									return (
										<div
											key={key}
											className={`group relative flex items-stretch hover:bg-zinc-700 ${
												isCurrent ? "bg-zinc-700/50" : ""
											}`}
										>
											<button
												onClick={() => handleOpenRecent(entry)}
												className="flex-1 min-w-0 text-left px-3 py-1.5 text-sm"
											>
												<div className="flex items-center gap-2">
													{entry.type === "remote" && (
														<span className="text-[10px] px-1 py-0.5 bg-emerald-700/70 text-emerald-100 rounded">
															SSH
														</span>
													)}
													<span className="text-zinc-200">{name}</span>
													{isCurrent && (
														<span className="text-[10px] text-zinc-500">current</span>
													)}
												</div>
												<div className="text-xs text-zinc-500 truncate">{subtitle}</div>
											</button>
											<button
												onClick={(e) => {
													e.stopPropagation();
													removeRecentRepo(entry);
												}}
												className="opacity-0 group-hover:opacity-100 px-2 text-zinc-500 hover:text-red-400"
												title="Remove from recent"
												aria-label={`Remove ${name} from recent`}
											>
												&times;
											</button>
										</div>
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

			{/* Update available indicator */}
			{updateAvailable && (
				<button
					onClick={installUpdate}
					disabled={installing}
					className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-600 text-white text-xs rounded font-medium"
					title="Download and install update"
				>
					{installing ? (
						<>
							<svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
								<circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
								<path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
							</svg>
							Installing...
						</>
					) : (
						<>
							<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
								<path d="M8 2v9M4 8l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
								<line x1="2" y1="14" x2="14" y2="14" strokeLinecap="round" />
							</svg>
							Update {updateVersion}
						</>
					)}
				</button>
			)}

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

			{showRemoteDialog && (
				<ConnectionDialog onClose={() => setShowRemoteDialog(false)} />
			)}
		</div>
	);
}
