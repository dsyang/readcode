import type { ReviewSession } from "../../api/reviewTypes";

export interface CommentedLines {
	old: Set<number>;
	new: Set<number>;
}

export function buildCommentedLinesMap(
	session: ReviewSession | null,
): Map<string, CommentedLines> {
	const map = new Map<string, CommentedLines>();
	if (!session) return map;

	for (const c of session.comments) {
		let entry = map.get(c.file);
		if (!entry) {
			entry = { old: new Set(), new: new Set() };
			map.set(c.file, entry);
		}
		const side = c.line_range.side === "old" ? entry.old : entry.new;
		for (let l = c.line_range.start; l <= c.line_range.end; l++) {
			side.add(l);
		}
	}
	return map;
}
