import { useState } from "react";
import { useReviewStore } from "../../stores/reviewStore";
import { useSelectionStore } from "../../stores/selectionStore";
import type { Comment } from "../../api/reviewTypes";
import { CommentEditor } from "./CommentEditor";

export function CommentPanel() {
	const session = useReviewStore((s) => s.session);
	const isSessionActive = useReviewStore((s) => s.isSessionActive);
	const startSession = useReviewStore((s) => s.startSession);
	const resumeSession = useReviewStore((s) => s.resumeSession);
	const endSession = useReviewStore((s) => s.endSession);
	const exportSession = useReviewStore((s) => s.exportSession);
	const pendingComment = useReviewStore((s) => s.pendingComment);
	const existingSessionIds = useReviewStore((s) => s.existingSessionIds);
	const discardExistingSession = useReviewStore((s) => s.discardExistingSession);

	const currentBranch = useSelectionStore((s) => s.currentBranch);
	const selectedCommitOids = useSelectionStore((s) => s.selectedCommitOids);
	const includeWorkingTree = useSelectionStore((s) => s.includeWorkingTree);
	const mergedDiff = useSelectionStore((s) => s.mergedDiff);

	const [exported, setExported] = useState(false);
	const [confirmEnd, setConfirmEnd] = useState(false);

	async function handleStartSession() {
		const commits = Array.from(selectedCommitOids);
		const head = includeWorkingTree
			? "WORKING_TREE"
			: commits.length > 0
				? commits[commits.length - 1]
				: "HEAD";
		await startSession(currentBranch, mergedDiff?.base_oid ?? null, head, commits);
	}

	async function handleExport() {
		const json = await exportSession();
		await navigator.clipboard.writeText(json);
		setExported(true);
		setTimeout(() => setExported(false), 2000);
	}

	function handleEndClick() {
		if (confirmEnd) {
			endSession();
			setConfirmEnd(false);
		} else {
			setConfirmEnd(true);
			setTimeout(() => setConfirmEnd(false), 3000);
		}
	}

	if (!isSessionActive) {
		return (
			<div className="flex flex-col items-center justify-center h-full gap-3 p-4 text-sm">
				{existingSessionIds.length > 0 && (
					<div className="w-full border border-zinc-700 rounded p-3 bg-zinc-800/50">
						<p className="text-zinc-400 text-xs mb-2">
							{existingSessionIds.length} unfinished review{existingSessionIds.length > 1 ? "s" : ""} found:
						</p>
						{existingSessionIds.map((id) => (
							<div
								key={id}
								className="group flex items-stretch hover:bg-zinc-700 rounded"
							>
								<button
									onClick={() => resumeSession(id)}
									className="flex-1 text-left px-2 py-1.5 text-xs"
								>
									<span className="text-blue-400">Resume</span>
									<span className="text-zinc-500 font-mono ml-2">{id.substring(0, 8)}...</span>
								</button>
								<button
									onClick={() => discardExistingSession(id)}
									className="opacity-0 group-hover:opacity-100 px-2 text-zinc-500 hover:text-red-400 text-xs"
									title="Discard session (delete file)"
									aria-label={`Discard session ${id.substring(0, 8)}`}
								>
									&times;
								</button>
							</div>
						))}
					</div>
				)}
				<p className="text-zinc-500 text-center">
					{existingSessionIds.length > 0
						? "Or start a new review session."
						: "Start a review session to leave comments on the diff."}
				</p>
				<button
					onClick={handleStartSession}
					disabled={!mergedDiff}
					className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-600 disabled:text-zinc-400 rounded text-white font-medium"
				>
					Start New Review
				</button>
			</div>
		);
	}

	// Group comments by file
	const commentsByFile = new Map<string, Comment[]>();
	for (const c of session?.comments ?? []) {
		const list = commentsByFile.get(c.file) ?? [];
		list.push(c);
		commentsByFile.set(c.file, list);
	}

	const commentCount = session?.comments.length ?? 0;

	return (
		<div className="flex flex-col h-full">
			{/* Header */}
			<div className="border-b border-zinc-700">
				<div className="flex items-center gap-2 px-3 py-2 text-sm">
					<span className="text-zinc-300 font-medium">Review</span>
					<span className="text-xs text-zinc-500">
						{commentCount} comment{commentCount !== 1 ? "s" : ""}
					</span>
					<div className="flex-1" />
					<button
						onClick={handleExport}
						className="text-xs text-zinc-400 hover:text-white px-2 py-0.5 rounded hover:bg-zinc-700"
						title="Copy full session JSON to clipboard (paste into Claude or another AI agent)"
					>
						{exported ? "Copied!" : "Copy for AI"}
					</button>
					<button
						onClick={handleEndClick}
						className={`text-xs px-2 py-0.5 rounded ${
							confirmEnd
								? "bg-red-800 text-red-200"
								: "text-zinc-400 hover:text-red-400 hover:bg-zinc-700"
						}`}
						title="End review session"
					>
						{confirmEnd ? "Confirm end?" : "End"}
					</button>
				</div>
				{session && (
					<div
						className="px-3 pb-1.5 text-[10px] text-zinc-600 font-mono truncate cursor-pointer hover:text-zinc-400"
						title={`${session.session.review_location}/sessions/${session.session.id}.json`}
						onClick={() => navigator.clipboard.writeText(`${session.session.review_location}/sessions/${session.session.id}.json`)}
					>
						sessions/{session.session.id.substring(0, 8)}...json
					</div>
				)}
			</div>

			{/* Pending comment editor */}
			{pendingComment && <CommentEditor />}

			{/* Comment list */}
			<div className="flex-1 overflow-y-auto">
				{commentCount === 0 && !pendingComment && (
					<div className="p-4 text-sm text-zinc-500 text-center">
						Click the + in the diff gutter to add a comment.
						<br />
						Select lines first to comment on a range.
					</div>
				)}

				{Array.from(commentsByFile.entries()).map(([file, comments]) => (
					<FileCommentGroup key={file} file={file} comments={comments} />
				))}
			</div>

			{/* Summary */}
			{session && <SessionSummary />}
		</div>
	);
}

interface FileCommentGroupProps {
	file: string;
	comments: Comment[];
}

function FileCommentGroup({ file, comments }: FileCommentGroupProps) {
	const toggleResolved = useReviewStore((s) => s.toggleResolved);
	const deleteComment = useReviewStore((s) => s.deleteComment);
	const scrollToComment = useReviewStore((s) => s.scrollToComment);

	const fileName = file.split("/").pop() ?? file;

	return (
		<div className="border-b border-zinc-800">
			<div className="px-3 py-1 text-xs text-zinc-500 font-mono bg-zinc-800/50">
				{fileName}
			</div>
			{comments.map((c) => (
				<div
					key={c.id}
					onClick={() => scrollToComment(c.file, c.line_range.start, c.line_range.side)}
					className={`px-3 py-2 border-b border-zinc-800/50 cursor-pointer hover:bg-zinc-800/70 ${
						c.resolved ? "opacity-50" : ""
					}`}
				>
					<div className="flex items-start gap-2">
						<div className="flex-1 min-w-0">
							<div className="flex items-center gap-1.5 mb-1">
								<SeverityBadge severity={c.severity} />
								<span className="text-xs text-zinc-500">
									L{c.line_range.start}
									{c.line_range.end !== c.line_range.start && `-${c.line_range.end}`}
								</span>
								<span className="text-xs text-zinc-600">
									{c.line_range.side}
								</span>
							</div>
							<p className="text-sm text-zinc-300 whitespace-pre-wrap">{c.body}</p>
						</div>
						<div className="flex gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
							<button
								onClick={() => toggleResolved(c.id)}
								className={`text-xs px-1.5 py-0.5 rounded ${
									c.resolved
										? "text-green-400 hover:bg-zinc-700"
										: "text-zinc-500 hover:text-green-400 hover:bg-zinc-700"
								}`}
								title={c.resolved ? "Unresolve" : "Resolve"}
							>
								{c.resolved ? "\u2713" : "\u25CB"}
							</button>
							<button
								onClick={() => deleteComment(c.id)}
								className="text-xs text-zinc-600 hover:text-red-400 px-1.5 py-0.5 rounded hover:bg-zinc-700"
								title="Delete"
							>
								\u2715
							</button>
						</div>
					</div>
				</div>
			))}
		</div>
	);
}

function SeverityBadge({ severity }: { severity: string }) {
	const colors: Record<string, string> = {
		error: "bg-red-800/60 text-red-300",
		warning: "bg-yellow-800/60 text-yellow-300",
		suggestion: "bg-blue-800/60 text-blue-300",
		info: "bg-zinc-700 text-zinc-400",
	};

	return (
		<span className={`text-[10px] px-1.5 py-0 rounded leading-4 ${colors[severity] ?? colors.info}`}>
			{severity}
		</span>
	);
}

function SessionSummary() {
	const session = useReviewStore((s) => s.session);
	const setSummary = useReviewStore((s) => s.setSummary);
	const [editing, setEditing] = useState(false);
	const [text, setText] = useState(session?.summary ?? "");

	function handleSave() {
		setSummary(text);
		setEditing(false);
	}

	return (
		<div className="border-t border-zinc-700 p-3">
			<div className="flex items-center gap-2 mb-1">
				<span className="text-xs text-zinc-500">Summary</span>
				{!editing && (
					<button
						onClick={() => { setText(session?.summary ?? ""); setEditing(true); }}
						className="text-xs text-zinc-500 hover:text-white"
					>
						edit
					</button>
				)}
			</div>
			{editing ? (
				<div className="flex flex-col gap-1">
					<textarea
						value={text}
						onChange={(e) => setText(e.target.value)}
						className="w-full bg-zinc-800 border border-zinc-600 rounded p-2 text-sm text-zinc-300 resize-none"
						rows={3}
						autoFocus
					/>
					<div className="flex gap-1 justify-end">
						<button onClick={() => setEditing(false)} className="text-xs text-zinc-500 px-2 py-1">Cancel</button>
						<button onClick={handleSave} className="text-xs bg-blue-600 text-white px-2 py-1 rounded">Save</button>
					</div>
				</div>
			) : (
				<p className="text-sm text-zinc-400">
					{session?.summary || "No summary yet"}
				</p>
			)}
		</div>
	);
}
