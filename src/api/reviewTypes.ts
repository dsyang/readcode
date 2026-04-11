export interface ReviewSession {
	version: string;
	session: SessionMeta;
	comments: Comment[];
	edits: Edit[];
	summary: string | null;
}

export interface SessionMeta {
	id: string;
	repo: string;
	branch: string | null;
	base_commit: string | null;
	head_commit: string;
	reviewed_commits: string[];
	created_at: string;
	updated_at: string;
}

export interface Comment {
	id: string;
	type: CommentType;
	file: string;
	line_range: LineRange;
	body: string;
	severity: Severity;
	resolved: boolean;
	created_at: string;
	context: CommentContext;
}

export type CommentType = "comment" | "suggestion" | "issue" | "auto_edit";
export type Severity = "info" | "warning" | "error" | "suggestion";
export type DiffSide = "old" | "new";

export interface LineRange {
	side: DiffSide;
	start: number;
	end: number;
}

export interface CommentContext {
	before: string;
	content: string;
	after: string;
}

export interface Edit {
	id: string;
	file: string;
	line_range: EditLineRange;
	old_content: string;
	new_content: string;
	description: string;
	applied_at: string;
	associated_comment_id: string | null;
}

export interface EditLineRange {
	start: number;
	end: number;
}

export interface AddCommentArgs {
	file: string;
	side: DiffSide;
	start_line: number;
	end_line: number;
	body: string;
	comment_type: CommentType;
	severity: Severity;
	context_before: string;
	context_content: string;
	context_after: string;
}

export interface AddEditArgs {
	file: string;
	start_line: number;
	end_line: number;
	old_content: string;
	new_content: string;
	description: string;
	associated_comment_id: string | null;
}
