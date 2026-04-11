import { useSelectionStore } from "../../stores/selectionStore";
import type { CommitInfo } from "../../api/types";

export function CommitList() {
	const commits = useSelectionStore((s) => s.commits);
	const selectedOids = useSelectionStore((s) => s.selectedCommitOids);
	const toggleCommitSelection = useSelectionStore((s) => s.toggleCommitSelection);

	if (commits.length === 0) {
		return (
			<div className="flex items-center justify-center h-full text-zinc-500 text-sm">
				Open a repository to see commits
			</div>
		);
	}

	return (
		<div className="overflow-y-auto h-full">
			{commits.map((commit) => (
				<CommitRow
					key={commit.oid}
					commit={commit}
					isSelected={selectedOids.has(commit.oid)}
					onToggle={toggleCommitSelection}
				/>
			))}
		</div>
	);
}

interface CommitRowProps {
	commit: CommitInfo;
	isSelected: boolean;
	onToggle: (oid: string, shiftKey: boolean) => void;
}

function CommitRow({ commit, isSelected, onToggle }: CommitRowProps) {
	const date = new Date(commit.timestamp * 1000);
	const timeStr = date.toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
	});

	return (
		<div
			onClick={(e) => onToggle(commit.oid, e.shiftKey)}
			className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer border-l-2 text-sm ${
				isSelected
					? "bg-blue-900/40 border-blue-500 text-white"
					: "border-transparent text-zinc-300 hover:bg-zinc-800"
			}`}
		>
			{/* Graph dot */}
			<div className="flex-shrink-0">
				<div
					className={`w-2.5 h-2.5 rounded-full ${
						commit.is_head
							? "bg-green-400 ring-2 ring-green-400/30"
							: isSelected
								? "bg-blue-400"
								: "bg-zinc-500"
					}`}
				/>
			</div>

			{/* Short hash */}
			<span className="font-mono text-xs text-zinc-500 flex-shrink-0 w-14">
				{commit.short_oid}
			</span>

			{/* Summary */}
			<span className="truncate flex-1">{commit.summary}</span>

			{/* Branches / tags */}
			{commit.branches.length > 0 && (
				<div className="flex gap-1 flex-shrink-0">
					{commit.branches.map((b) => (
						<span
							key={b}
							className="px-1.5 py-0.5 text-xs rounded bg-green-800/50 text-green-300"
						>
							{b}
						</span>
					))}
				</div>
			)}
			{commit.tags.length > 0 && (
				<div className="flex gap-1 flex-shrink-0">
					{commit.tags.map((t) => (
						<span
							key={t}
							className="px-1.5 py-0.5 text-xs rounded bg-yellow-800/50 text-yellow-300"
						>
							{t}
						</span>
					))}
				</div>
			)}

			{/* Author + date */}
			<span className="text-xs text-zinc-500 flex-shrink-0 w-20 text-right">
				{commit.author_name.split(" ")[0]}
			</span>
			<span className="text-xs text-zinc-600 flex-shrink-0 w-14 text-right">
				{timeStr}
			</span>
		</div>
	);
}
