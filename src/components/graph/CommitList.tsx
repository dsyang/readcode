import { useMemo } from "react";
import { useSelectionStore } from "../../stores/selectionStore";
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

/** Active lanes entering each row: lane -> color index */
type ActiveLanes = Map<number, number>;

/**
 * Walk commits top-to-bottom and compute which lanes have a line
 * entering from above at each row.
 */
function computeActiveLanes(commits: CommitInfo[]): ActiveLanes[] {
	const result: ActiveLanes[] = [];
	// Lanes that currently have a downward line running through them
	const active = new Map<number, number>();

	for (const commit of commits) {
		// Snapshot the incoming active lanes for this row
		result.push(new Map(active));

		// This commit's node consumes its lane
		active.delete(commit.lane);

		// Its edges create new active lanes going down
		for (const edge of commit.edges) {
			active.set(edge.to_lane, edge.color);
		}
	}

	return result;
}

export function CommitList() {
	const commits = useSelectionStore((s) => s.commits);
	const repoPath = useSelectionStore((s) => s.repoPath);
	const selectedOids = useSelectionStore((s) => s.selectedCommitOids);
	const includeWorkingTree = useSelectionStore((s) => s.includeWorkingTree);
	const handleCommitClick = useSelectionStore((s) => s.handleCommitClick);
	const toggleWorkingTree = useSelectionStore((s) => s.toggleWorkingTree);

	const activeLanesPerRow = useMemo(() => computeActiveLanes(commits), [commits]);

	if (!repoPath) {
		return (
			<div className="flex items-center justify-center h-full text-zinc-500 text-sm">
				Open a repository to see commits
			</div>
		);
	}

	const maxLanes = Math.max(...commits.map((c) => c.lane_count), 1);
	const graphWidth = maxLanes * LANE_WIDTH + 8;

	return (
		<div className="overflow-y-auto h-full select-none">
			{/* Working Tree pseudo-entry */}
			<div
				onClick={toggleWorkingTree}
				className={`flex items-stretch cursor-pointer border-b border-zinc-800 ${
					includeWorkingTree
						? "bg-amber-900/30"
						: "hover:bg-zinc-800/50"
				}`}
				style={{ height: ROW_HEIGHT }}
			>
				<div className="flex-shrink-0 flex items-center justify-center" style={{ width: graphWidth }}>
					<div className={`w-2.5 h-2.5 rounded-sm ${
						includeWorkingTree ? "bg-amber-400" : "bg-zinc-600 border border-zinc-500"
					}`} />
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
					isSelected={selectedOids.has(commit.oid)}
					onClick={handleCommitClick}
				/>
			))}
		</div>
	);
}

interface CommitRowProps {
	commit: CommitInfo;
	graphWidth: number;
	activeLanes: ActiveLanes;
	isSelected: boolean;
	onClick: (oid: string, metaKey: boolean, shiftKey: boolean) => void;
}

function CommitRow({ commit, graphWidth, activeLanes, isSelected, onClick }: CommitRowProps) {
	const date = new Date(commit.timestamp * 1000);
	const timeStr = formatRelativeDate(date);
	const authorDisplay = formatAuthor(commit.author_name, commit.author_email);

	return (
		<div
			onClick={(e) => onClick(commit.oid, e.metaKey || e.ctrlKey, e.shiftKey)}
			className={`flex items-stretch cursor-pointer border-b border-zinc-800 ${
				isSelected
					? "bg-blue-900/40"
					: "hover:bg-zinc-800/50"
			}`}
			style={{ height: ROW_HEIGHT }}
		>
			{/* DAG graph column */}
			<div className="flex-shrink-0" style={{ width: graphWidth }}>
				<svg width={graphWidth} height={ROW_HEIGHT}>
					{/* Pass-through lines for active lanes that aren't this commit's lane */}
					{Array.from(activeLanes.entries()).map(([lane, color]) => {
						if (lane === commit.lane) return null;
						const x = lane * LANE_WIDTH + LANE_WIDTH / 2 + 4;
						return (
							<line
								key={`through-${lane}`}
								x1={x} y1={0} x2={x} y2={ROW_HEIGHT}
								stroke={laneColor(color)} strokeWidth={2}
							/>
						);
					})}

					{/* Incoming line on this commit's lane (top -> node center) */}
					{activeLanes.has(commit.lane) && (
						<line
							x1={commit.lane * LANE_WIDTH + LANE_WIDTH / 2 + 4}
							y1={0}
							x2={commit.lane * LANE_WIDTH + LANE_WIDTH / 2 + 4}
							y2={ROW_HEIGHT / 2}
							stroke={laneColor(activeLanes.get(commit.lane)!)}
							strokeWidth={2}
						/>
					)}

					{/* Edges from node center down to parents */}
					{commit.edges.map((edge, i) => {
						const x1 = edge.from_lane * LANE_WIDTH + LANE_WIDTH / 2 + 4;
						const x2 = edge.to_lane * LANE_WIDTH + LANE_WIDTH / 2 + 4;
						const y1 = ROW_HEIGHT / 2;
						const y2 = ROW_HEIGHT;
						const color = laneColor(edge.color);

						if (x1 === x2) {
							return (
								<line
									key={`edge-${i}`}
									x1={x1} y1={y1} x2={x2} y2={y2}
									stroke={color} strokeWidth={2}
								/>
							);
						} else {
							const midY = (y1 + y2) / 2;
							return (
								<path
									key={`edge-${i}`}
									d={`M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`}
									stroke={color} strokeWidth={2} fill="none"
								/>
							);
						}
					})}

					{/* Commit node */}
					<circle
						cx={commit.lane * LANE_WIDTH + LANE_WIDTH / 2 + 4}
						cy={ROW_HEIGHT / 2}
						r={NODE_RADIUS}
						fill={commit.is_head ? "#4ade80" : isSelected ? "#60a5fa" : laneColor(commit.edges.length > 0 ? commit.edges[0].color : commit.lane)}
						stroke={commit.is_head ? "#4ade80" : "none"}
						strokeWidth={commit.is_head ? 2 : 0}
					/>
				</svg>
			</div>

			{/* Commit info: two lines */}
			<div className="flex-1 min-w-0 flex flex-col justify-center py-1 pr-3">
				<div className="flex items-center gap-1.5 min-w-0">
					<span className={`truncate text-sm ${isSelected ? "text-white" : "text-zinc-200"}`}>
						{commit.summary}
					</span>
					{commit.branches
						.filter((b) => !b.startsWith("origin/"))
						.map((b) => (
							<span
								key={b}
								className="flex-shrink-0 px-1.5 py-0 text-[11px] rounded bg-teal-800/60 text-teal-300 leading-4"
							>
								{b}
							</span>
						))}
					{commit.tags.map((t) => (
						<span
							key={t}
							className="flex-shrink-0 px-1.5 py-0 text-[11px] rounded bg-yellow-800/50 text-yellow-300 leading-4"
						>
							{t}
						</span>
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
	if (ghUsername && ghUsername !== name) {
		return `${name} (${ghUsername})`;
	}
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
		month: "short",
		day: "numeric",
		year: date.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
	});
}
