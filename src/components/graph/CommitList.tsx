import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { useSelectionStore } from "../../stores/selectionStore";
import { useReviewStore } from "../../stores/reviewStore";
import { createBranch, getCommitMessage } from "../../api/git";
import type { CommitInfo } from "../../api/types";

const LANE_WIDTH = 16;
const ROW_HEIGHT = 48;
const NODE_RADIUS = 4;

const LANE_COLORS = [
	"#4ec9b0", // teal
	"#569cd6", // blue
	"#c586c0", // purple
	"#ce9178", // orange
	"#dcdcaa", // yellow
	"#9cdcfe", // light blue
	"#d16969", // red
	"#6a9955", // green
	"#b5cea8", // light green
	"#d4d4d4", // gray
];

function laneColor(index: number): string {
	return LANE_COLORS[index % LANE_COLORS.length];
}

type ActiveLanes = Map<number, number>;

function computeActiveLanes(commits: CommitInfo[]): ActiveLanes[] {
	const result: ActiveLanes[] = [];
	const active = new Map<number, number>();
	for (const commit of commits) {
		result.push(new Map(active));
		active.delete(commit.lane);
		for (const edge of commit.edges) {
			active.set(edge.to_lane, edge.color);
		}
	}
	// Append final state so each row N can read result[N+1] as its "after" state
	// for drawing continuation lines into wrapped rows.
	result.push(new Map(active));
	return result;
}

interface ContextMenu {
	x: number;
	y: number;
	commit: CommitInfo;
}

export function CommitList() {
	const commits = useSelectionStore((s) => s.commits);
	const repoPath = useSelectionStore((s) => s.repoPath);
	const selectedOids = useSelectionStore((s) => s.selectedCommitOids);
	const includeWorkingTree = useSelectionStore((s) => s.includeWorkingTree);
	const rawHandleCommitClick = useSelectionStore((s) => s.handleCommitClick);
	const rawToggleWorkingTree = useSelectionStore((s) => s.toggleWorkingTree);
	const reloadWorkingTree = useSelectionStore((s) => s.reloadWorkingTree);
	const clearSelection = useSelectionStore((s) => s.clearSelection);
	const refreshCommits = useSelectionStore((s) => s.refreshCommits);
	const isSessionActive = useReviewStore((s) => s.isSessionActive);
	const clearSession = useReviewStore((s) => s.clearSession);
	const checkExistingSessions = useReviewStore((s) => s.checkExistingSessions);

	const pauseReviewIfActive = useCallback(() => {
		if (isSessionActive) {
			clearSession();
			setTimeout(() => checkExistingSessions(), 50);
		}
	}, [isSessionActive, clearSession, checkExistingSessions]);

	const handleCommitClick = useCallback(
		(oid: string, metaKey: boolean, shiftKey: boolean) => {
			pauseReviewIfActive();
			rawHandleCommitClick(oid, metaKey, shiftKey);
		},
		[pauseReviewIfActive, rawHandleCommitClick],
	);

	const toggleWorkingTree = useCallback(() => {
		pauseReviewIfActive();
		rawToggleWorkingTree();
	}, [pauseReviewIfActive, rawToggleWorkingTree]);

	const activeLanesPerRow = useMemo(() => computeActiveLanes(commits), [commits]);
	const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
	const [commitDetail, setCommitDetail] = useState<{ commit: CommitInfo; message: string } | null>(null);
	const [branchPrompt, setBranchPrompt] = useState<{ commit: CommitInfo; name: string; error: string | null; submitting: boolean } | null>(null);
	const menuRef = useRef<HTMLDivElement>(null);
	const branchInputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (branchPrompt) branchInputRef.current?.focus();
	}, [branchPrompt]);

	useEffect(() => {
		function handleClick() { setContextMenu(null); }
		window.addEventListener("click", handleClick);
		return () => window.removeEventListener("click", handleClick);
	}, []);

	if (!repoPath) {
		return (
			<div className="flex items-center justify-center h-full text-zinc-500 text-sm">
				Open a repository to see commits
			</div>
		);
	}

	const maxLanes = Math.max(...commits.map((c) => c.lane_count), 1);
	const graphWidth = maxLanes * LANE_WIDTH + 8;
	const headLane = commits.length > 0 ? commits[0].lane : 0;
	const selectedCount = selectedOids.size;

	function handleContextMenu(e: React.MouseEvent, commit: CommitInfo) {
		e.preventDefault();
		setContextMenu({ x: e.clientX, y: e.clientY, commit });
	}

	async function copyToClipboard(text: string) {
		await navigator.clipboard.writeText(text);
		setContextMenu(null);
	}

	return (
		<div className="h-full flex flex-col select-none">
			{/* Header */}
			<div className="flex items-center px-3 py-1.5 text-xs text-zinc-500 border-b border-zinc-700 flex-shrink-0">
				<span>{commits.length} commits</span>
				{selectedCount > 0 && (
					<span className="ml-1">({selectedCount} selected)</span>
				)}
				<span className="ml-auto">
					{selectedCount > 0 && (
						<button
							onClick={clearSelection}
							className="text-zinc-400 hover:text-white"
						>
							clear
						</button>
					)}
				</span>
			</div>

			<div className="overflow-y-auto flex-1">
				{/* Working Tree pseudo-entry */}
				<div
					onClick={toggleWorkingTree}
					className={`flex items-stretch cursor-pointer border-b border-zinc-800 ${
						includeWorkingTree ? "bg-amber-900/30" : "hover:bg-zinc-800/50"
					}`}
					style={{ height: ROW_HEIGHT }}
				>
					<div className="flex-shrink-0" style={{ width: graphWidth }}>
						<svg width={graphWidth} height={ROW_HEIGHT}>
							<rect
								x={headLane * LANE_WIDTH + LANE_WIDTH / 2 + 4 - 4}
								y={ROW_HEIGHT / 2 - 4}
								width={8} height={8} rx={2}
								fill={includeWorkingTree ? "#fbbf24" : "#52525b"}
								stroke={includeWorkingTree ? "none" : "#71717a"}
								strokeWidth={1}
							/>
						</svg>
					</div>
					<div className="flex-1 min-w-0 flex flex-col justify-center py-1 pr-3">
						<div className="flex items-center gap-1.5">
							<span className={`text-sm italic ${
								includeWorkingTree ? "text-amber-200" : "text-zinc-400"
							}`}>
								Working Tree
							</span>
							{includeWorkingTree && (
								<span className="px-1.5 py-0 text-[11px] rounded bg-amber-800/60 text-amber-300 leading-4">
									included
								</span>
							)}
							{includeWorkingTree && (
								<button
									onClick={(e) => {
										e.stopPropagation();
										reloadWorkingTree();
									}}
									className="p-0.5 text-zinc-500 hover:text-amber-300 rounded hover:bg-zinc-700/50"
									title="Refresh working tree"
								>
									<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
										<path d="M2.5 8a5.5 5.5 0 0 1 9.3-4" />
										<path d="M13.5 8a5.5 5.5 0 0 1-9.3 4" />
										<polyline points="12 2 12 5 9 5" fill="none" />
										<polyline points="4 14 4 11 7 11" fill="none" />
									</svg>
								</button>
							)}
						</div>
						<div className="text-xs text-zinc-500 mt-0.5">
							Uncommitted changes
						</div>
					</div>
				</div>

				{commits.map((commit, row) => (
					<CommitRow
						key={commit.oid}
						commit={commit}
						graphWidth={graphWidth}
						activeLanes={activeLanesPerRow[row]}
						nextActiveLanes={activeLanesPerRow[row + 1]}
						isSelected={selectedOids.has(commit.oid)}
						onClick={handleCommitClick}
						onContextMenu={handleContextMenu}
					/>
				))}
			</div>

			{/* Context menu */}
			{contextMenu && (
				<div
					ref={menuRef}
					className="fixed bg-zinc-800 border border-zinc-600 rounded shadow-xl z-50 py-1 min-w-48"
					style={{ left: contextMenu.x, top: contextMenu.y }}
				>
					<button
						onClick={async () => {
							const commit = contextMenu.commit;
							setContextMenu(null);
							try {
								const message = await getCommitMessage(commit.oid);
								setCommitDetail({ commit, message });
							} catch (e) {
								setCommitDetail({ commit, message: `Error: ${e}` });
							}
						}}
						className="w-full text-left px-3 py-1.5 hover:bg-zinc-700 text-sm text-zinc-200"
					>
						Show commit message
					</button>
					<div className="border-t border-zinc-700 my-1" />
					<button
						onClick={() => copyToClipboard(contextMenu.commit.short_oid)}
						className="w-full text-left px-3 py-1.5 hover:bg-zinc-700 text-sm text-zinc-200"
					>
						Copy hash <span className="text-zinc-500 font-mono ml-1">{contextMenu.commit.short_oid}</span>
					</button>
					<button
						onClick={() => copyToClipboard(contextMenu.commit.oid)}
						className="w-full text-left px-3 py-1.5 hover:bg-zinc-700 text-sm text-zinc-200"
					>
						Copy full hash
					</button>
					<div className="border-t border-zinc-700 my-1" />
					<button
						onClick={() => {
							const commit = contextMenu.commit;
							setContextMenu(null);
							setBranchPrompt({ commit, name: "", error: null, submitting: false });
						}}
						className="w-full text-left px-3 py-1.5 hover:bg-zinc-700 text-sm text-zinc-200"
					>
						Create new branch at this commit
					</button>
					{contextMenu.commit.branches.filter((b) => !b.startsWith("origin/")).map((b) => (
						<button
							key={b}
							onClick={() => copyToClipboard(b)}
							className="w-full text-left px-3 py-1.5 hover:bg-zinc-700 text-sm text-zinc-200"
						>
							Copy branch <span className="text-teal-400 ml-1">{b}</span>
						</button>
					))}
				</div>
			)}

			{/* Create branch modal */}
			{branchPrompt && (
				<div
					className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
					onClick={() => !branchPrompt.submitting && setBranchPrompt(null)}
				>
					<form
						className="bg-zinc-800 border border-zinc-700 rounded-lg shadow-2xl w-[420px] flex flex-col select-text"
						onClick={(e) => e.stopPropagation()}
						onSubmit={async (e) => {
							e.preventDefault();
							const name = branchPrompt.name.trim();
							if (!name) {
								setBranchPrompt({ ...branchPrompt, error: "Branch name cannot be empty" });
								return;
							}
							setBranchPrompt({ ...branchPrompt, submitting: true, error: null });
							try {
								await createBranch(name, branchPrompt.commit.oid);
								setBranchPrompt(null);
								await refreshCommits();
							} catch (err) {
								setBranchPrompt({ ...branchPrompt, submitting: false, error: String(err) });
							}
						}}
					>
						<div className="px-5 py-3 border-b border-zinc-700">
							<div className="text-sm text-zinc-200">Create new branch</div>
							<div className="text-xs text-zinc-500 mt-1">
								at <span className="font-mono">{branchPrompt.commit.short_oid}</span>
								<span className="ml-2">{branchPrompt.commit.summary}</span>
							</div>
						</div>
						<div className="px-5 py-4">
							<input
								ref={branchInputRef}
								type="text"
								value={branchPrompt.name}
								onChange={(e) => setBranchPrompt({ ...branchPrompt, name: e.target.value, error: null })}
								placeholder="branch name"
								disabled={branchPrompt.submitting}
								className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-100 focus:outline-none focus:border-zinc-500"
							/>
							{branchPrompt.error && (
								<div className="mt-2 text-xs text-red-400">{branchPrompt.error}</div>
							)}
						</div>
						<div className="flex justify-end gap-2 px-5 py-3 border-t border-zinc-700">
							<button
								type="button"
								onClick={() => setBranchPrompt(null)}
								disabled={branchPrompt.submitting}
								className="px-3 py-1 text-sm text-zinc-300 hover:text-white"
							>
								Cancel
							</button>
							<button
								type="submit"
								disabled={branchPrompt.submitting || !branchPrompt.name.trim()}
								className="px-3 py-1 text-sm bg-teal-700 hover:bg-teal-600 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded"
							>
								{branchPrompt.submitting ? "Creating..." : "Create"}
							</button>
						</div>
					</form>
				</div>
			)}

			{/* Commit message modal */}
			{commitDetail && (
				<div
					className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
					onClick={() => setCommitDetail(null)}
				>
					<div
						className="bg-zinc-800 border border-zinc-700 rounded-lg shadow-2xl w-[560px] max-h-[70vh] flex flex-col select-text"
						onClick={(e) => e.stopPropagation()}
					>
						<div className="flex items-center justify-between px-5 py-3 border-b border-zinc-700">
							<div className="flex items-center gap-2 min-w-0">
								<span className="font-mono text-xs text-zinc-400">{commitDetail.commit.short_oid}</span>
								<span className="text-xs text-zinc-500">{commitDetail.commit.author_name}</span>
								<span className="text-xs text-zinc-500">
									{new Date(commitDetail.commit.timestamp * 1000).toLocaleString(undefined, {
										year: "numeric", month: "short", day: "numeric",
										hour: "2-digit", minute: "2-digit",
									})}
								</span>
							</div>
							<button
								onClick={() => setCommitDetail(null)}
								className="text-zinc-400 hover:text-white text-lg leading-none ml-3"
							>
								&times;
							</button>
						</div>
						<div className="overflow-y-auto px-5 py-4">
							<pre className="text-sm text-zinc-200 whitespace-pre-wrap font-sans">{commitDetail.message.trim()}</pre>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}

interface CommitRowProps {
	commit: CommitInfo;
	graphWidth: number;
	activeLanes: ActiveLanes;
	nextActiveLanes: ActiveLanes;
	isSelected: boolean;
	onClick: (oid: string, metaKey: boolean, shiftKey: boolean) => void;
	onContextMenu: (e: React.MouseEvent, commit: CommitInfo) => void;
}

function CommitRow({ commit, graphWidth, activeLanes, nextActiveLanes, isSelected, onClick, onContextMenu }: CommitRowProps) {
	const date = new Date(commit.timestamp * 1000);
	const timeStr = formatRelativeDate(date);
	const authorDisplay = formatAuthor(commit.author_name, commit.author_email);

	return (
		<div
			onClick={(e) => onClick(commit.oid, e.metaKey || e.ctrlKey, e.shiftKey)}
			onContextMenu={(e) => onContextMenu(e, commit)}
			className={`flex items-stretch cursor-pointer border-b border-zinc-800 ${
				isSelected ? "bg-blue-900/40" : "hover:bg-zinc-800/50"
			}`}
			style={{ minHeight: ROW_HEIGHT }}
		>
			<div className="flex-shrink-0 flex flex-col" style={{ width: graphWidth }}>
				<svg width={graphWidth} height={ROW_HEIGHT} className="flex-shrink-0">
					{Array.from(activeLanes.entries()).map(([lane, color]) => {
						if (lane === commit.lane) return null;
						const x = lane * LANE_WIDTH + LANE_WIDTH / 2 + 4;
						return (
							<line key={`through-${lane}`}
								x1={x} y1={0} x2={x} y2={ROW_HEIGHT}
								stroke={laneColor(color)} strokeWidth={2}
							/>
						);
					})}
					{activeLanes.has(commit.lane) && (
						<line
							x1={commit.lane * LANE_WIDTH + LANE_WIDTH / 2 + 4} y1={0}
							x2={commit.lane * LANE_WIDTH + LANE_WIDTH / 2 + 4} y2={ROW_HEIGHT / 2}
							stroke={laneColor(activeLanes.get(commit.lane)!)} strokeWidth={2}
						/>
					)}
					{commit.edges.map((edge, i) => {
						const x1 = edge.from_lane * LANE_WIDTH + LANE_WIDTH / 2 + 4;
						const x2 = edge.to_lane * LANE_WIDTH + LANE_WIDTH / 2 + 4;
						const y1 = ROW_HEIGHT / 2;
						const y2 = ROW_HEIGHT;
						const color = laneColor(edge.color);
						if (x1 === x2) {
							return <line key={`edge-${i}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={2} />;
						}
						const midY = (y1 + y2) / 2;
						return <path key={`edge-${i}`} d={`M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`} stroke={color} strokeWidth={2} fill="none" />;
					})}
					<circle
						cx={commit.lane * LANE_WIDTH + LANE_WIDTH / 2 + 4}
						cy={ROW_HEIGHT / 2}
						r={NODE_RADIUS}
						fill={commit.is_head ? "#4ade80" : isSelected ? "#60a5fa" : laneColor(commit.edges.length > 0 ? commit.edges[0].color : commit.lane)}
						stroke={commit.is_head ? "#4ade80" : "none"}
						strokeWidth={commit.is_head ? 2 : 0}
					/>
				</svg>
				{/* Continuation lines for any extra row height beyond ROW_HEIGHT
				    (e.g. when branch labels wrap). Without this, the timeline
				    breaks visually between a wrapped row and the next. */}
				<div className="flex-1 relative">
					{Array.from(nextActiveLanes.entries()).map(([lane, color]) => (
						<div
							key={`cont-${lane}`}
							className="absolute top-0 bottom-0"
							style={{
								left: lane * LANE_WIDTH + LANE_WIDTH / 2 + 4 - 1,
								width: 2,
								background: laneColor(color),
							}}
						/>
					))}
				</div>
			</div>
			<div className="flex-1 min-w-0 flex flex-col justify-center py-1 pr-3">
				<div className="flex flex-wrap items-center gap-1.5 min-w-0">
					<span
						className={`truncate text-sm flex-auto ${isSelected ? "text-white" : "text-zinc-200"}`}
						style={{ minWidth: "5rem" }}
					>
						{commit.summary}
					</span>
					{commit.branches.filter((b) => !b.startsWith("origin/")).map((b) => (
						<span key={b} className="flex-shrink-0 px-1.5 py-0 text-[11px] rounded bg-teal-800/60 text-teal-300 leading-4">{b}</span>
					))}
					{commit.tags.map((t) => (
						<span key={t} className="flex-shrink-0 px-1.5 py-0 text-[11px] rounded bg-yellow-800/50 text-yellow-300 leading-4">{t}</span>
					))}
				</div>
				<div className="flex items-center gap-2 text-xs text-zinc-500 mt-0.5">
					<span>{authorDisplay}</span>
					<span className="font-mono">{commit.short_oid}</span>
					<span className="ml-auto flex-shrink-0">{timeStr}</span>
				</div>
			</div>
		</div>
	);
}

function formatAuthor(name: string, email: string): string {
	const ghUsername = extractGitHubUsername(email);
	if (ghUsername && ghUsername !== name) return `${name} (${ghUsername})`;
	return name;
}

function extractGitHubUsername(email: string): string | null {
	if (email.endsWith("@users.noreply.github.com")) {
		const local = email.split("@")[0];
		const plusIdx = local.indexOf("+");
		return plusIdx >= 0 ? local.substring(plusIdx + 1) : local;
	}
	return null;
}

function formatRelativeDate(date: Date): string {
	const now = Date.now();
	const diffMs = now - date.getTime();
	const diffMins = Math.floor(diffMs / 60000);
	const diffHours = Math.floor(diffMs / 3600000);
	const diffDays = Math.floor(diffMs / 86400000);
	if (diffMins < 1) return "just now";
	if (diffMins < 60) return `${diffMins}m ago`;
	if (diffHours < 24) return `${diffHours}h ago`;
	if (diffDays < 7) return `${diffDays}d ago`;
	return date.toLocaleDateString(undefined, {
		month: "short", day: "numeric",
		year: date.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
	});
}
