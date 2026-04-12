import { useState } from "react";
import { useReviewStore } from "../../stores/reviewStore";
import type { CommentType, Severity } from "../../api/reviewTypes";

export function CommentEditor() {
	const pendingComment = useReviewStore((s) => s.pendingComment);
	const addComment = useReviewStore((s) => s.addComment);
	const cancelComment = useReviewStore((s) => s.cancelComment);

	const [body, setBody] = useState("");
	const [severity, setSeverity] = useState<Severity>("info");
	const [commentType, setCommentType] = useState<CommentType>("comment");

	if (!pendingComment) return null;

	async function handleSubmit() {
		if (!body.trim() || !pendingComment) return;
		await addComment({
			file: pendingComment.file,
			side: pendingComment.side,
			start_line: pendingComment.startLine,
			end_line: pendingComment.endLine,
			body: body.trim(),
			comment_type: commentType,
			severity,
			context_before: "",
			context_content: "",
			context_after: "",
		});
		setBody("");
	}

	function handleKeyDown(e: React.KeyboardEvent) {
		if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			handleSubmit();
		}
		if (e.key === "Escape") {
			cancelComment();
		}
	}

	const fileName = pendingComment.file.split("/").pop();
	const lineLabel = pendingComment.startLine === pendingComment.endLine
		? `L${pendingComment.startLine}`
		: `L${pendingComment.startLine}-${pendingComment.endLine}`;

	return (
		<div className="border-b border-zinc-700 p-3 bg-zinc-800/50">
			<div className="flex items-center gap-2 mb-2">
				<span className="text-xs text-zinc-400">
					{fileName}:{lineLabel} ({pendingComment.side})
				</span>
				<button
					onClick={cancelComment}
					className="ml-auto text-xs text-zinc-500 hover:text-white"
				>
					Cancel
				</button>
			</div>

			<textarea
				value={body}
				onChange={(e) => setBody(e.target.value)}
				onKeyDown={handleKeyDown}
				placeholder="Write a comment..."
				className="w-full bg-zinc-900 border border-zinc-600 rounded p-2 text-sm text-zinc-300 resize-none focus:border-blue-500 focus:outline-none"
				rows={3}
				autoFocus
			/>

			<div className="flex items-center gap-2 mt-2">
				<select
					value={commentType}
					onChange={(e) => setCommentType(e.target.value as CommentType)}
					className="bg-zinc-900 border border-zinc-600 rounded text-xs text-zinc-400 px-1.5 py-1"
				>
					<option value="comment">Comment</option>
					<option value="issue">Issue</option>
					<option value="suggestion">Suggestion</option>
				</select>

				<select
					value={severity}
					onChange={(e) => setSeverity(e.target.value as Severity)}
					className="bg-zinc-900 border border-zinc-600 rounded text-xs text-zinc-400 px-1.5 py-1"
				>
					<option value="info">Info</option>
					<option value="warning">Warning</option>
					<option value="error">Error</option>
					<option value="suggestion">Suggestion</option>
				</select>

				<div className="flex-1" />

				<span className="text-[10px] text-zinc-600">{"\u2318"}+Enter</span>
				<button
					onClick={handleSubmit}
					disabled={!body.trim()}
					className="px-3 py-1 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-600 disabled:text-zinc-400 rounded text-xs text-white font-medium"
				>
					Add
				</button>
			</div>
		</div>
	);
}
