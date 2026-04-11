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

export function CommitList() {
	const commits = useSelectionStore((s) => s.commits);
	const selectedOids = useSelectionStore((s) => s.selectedCommitOids);
	const handleCommitClick = useSelectionStore((s) => s.handleCommitClick);

	if (commits.length === 0) {
		return (
			<div className="flex items-center justify-center h-full text-zinc-500 text-sm">
				Open a repository to see commits
			</div>
		);
	}

	// Compute max lane count across all visible commits for SVG width
	const maxLanes = Math.max(...commits.map((c) => c.lane_count), 1);
	const graphWidth = maxLanes * LANE_WIDTH + 8;

	return (
		<div className="overflow-y-auto h-full">
			{commits.map((commit) => (
				<CommitRow
					key={commit.oid}
					commit={commit}
					graphWidth={graphWidth}
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
	isSelected: boolean;
	onClick: (oid: string, metaKey: boolean, shiftKey: boolean) => void;
}

function CommitRow({ commit, graphWidth, isSelected, onClick }: CommitRowProps) {
	const date = new Date(commit.timestamp * 1000);
	const timeStr = formatRelativeDate(date);

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
					{/* Edges to parents (drawn as lines going down to next row) */}
					{commit.edges.map((edge, i) => {
						const x1 = edge.from_lane * LANE_WIDTH + LANE_WIDTH / 2 + 4;
						const x2 = edge.to_lane * LANE_WIDTH + LANE_WIDTH / 2 + 4;
						const y1 = ROW_HEIGHT / 2;
						const y2 = ROW_HEIGHT;
						const color = laneColor(edge.color);

						if (x1 === x2) {
							// Straight line down
							return (
								<line
									key={i}
									x1={x1} y1={y1} x2={x2} y2={y2}
									stroke={color} strokeWidth={2}
								/>
							);
						} else {
							// Curved line to different lane
							const midY = (y1 + y2) / 2;
							return (
								<path
									key={i}
									d={`M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`}
									stroke={color} strokeWidth={2} fill="none"
								/>
							);
						}
					})}

					{/* Continuation lines from parents above */}
					{Array.from({ length: commit.lane_count }, (_, lane) => {
						// Draw a line from top to the node if this lane is "passing through"
						// A lane passes through if it's not this commit's lane but has an active edge
						if (lane === commit.lane) {
							// Draw line from top to center (the node)
							const x = lane * LANE_WIDTH + LANE_WIDTH / 2 + 4;
							return (
								<line
									key={`pass-${lane}`}
									x1={x} y1={0} x2={x} y2={ROW_HEIGHT / 2}
									stroke={laneColor(commit.edges.length > 0 ? commit.edges[0].color : lane)}
									strokeWidth={2}
								/>
							);
						}
						return null;
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
				{/* Line 1: summary + branches/tags */}
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
				{/* Line 2: author, date, hash */}
				<div className="flex items-center gap-2 text-xs text-zinc-500 mt-0.5">
					<span>{commit.author_name}</span>
					<span className="font-mono">{commit.short_oid}</span>
					<span className="ml-auto flex-shrink-0">{timeStr}</span>
				</div>
			</div>
		</div>
	);
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
