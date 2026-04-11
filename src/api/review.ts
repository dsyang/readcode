import { invoke } from "@tauri-apps/api/core";
import type { ReviewSession, AddCommentArgs, AddEditArgs } from "./reviewTypes";

export async function createSession(
	branch: string | null,
	baseCommit: string | null,
	headCommit: string,
	reviewedCommits: string[],
): Promise<ReviewSession> {
	return invoke<ReviewSession>("create_session", {
		branch, baseCommit, headCommit, reviewedCommits,
	});
}

export async function getSession(): Promise<ReviewSession | null> {
	return invoke<ReviewSession | null>("get_session");
}

export async function loadSession(sessionId: string): Promise<ReviewSession> {
	return invoke<ReviewSession>("load_session", { sessionId });
}

export async function listSessions(): Promise<string[]> {
	return invoke<string[]>("list_sessions");
}

export async function addComment(args: AddCommentArgs): Promise<ReviewSession> {
	return invoke<ReviewSession>("add_comment", { args });
}

export async function toggleCommentResolved(commentId: string): Promise<ReviewSession> {
	return invoke<ReviewSession>("toggle_comment_resolved", { commentId });
}

export async function deleteComment(commentId: string): Promise<ReviewSession> {
	return invoke<ReviewSession>("delete_comment", { commentId });
}

export async function addEdit(args: AddEditArgs): Promise<ReviewSession> {
	return invoke<ReviewSession>("add_edit", { args });
}

export async function exportSession(): Promise<string> {
	return invoke<string>("export_session");
}

export async function setSessionSummary(summary: string): Promise<ReviewSession> {
	return invoke<ReviewSession>("set_session_summary", { summary });
}
