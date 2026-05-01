import { create } from "zustand";
import type { ReviewSession, AddCommentArgs } from "../api/reviewTypes";
import * as api from "../api/review";
import { useSelectionStore } from "./selectionStore";
import { diag } from "../diagnostics";

interface ReviewState {
	session: ReviewSession | null;
	isSessionActive: boolean;
	editMode: boolean;
	pendingComment: PendingComment | null;
	scrollTarget: ScrollTarget | null;

	// Existing sessions found in repo
	existingSessionIds: string[];

	// Actions
	startSession: (
		branch: string | null,
		baseCommit: string | null,
		headCommit: string,
		reviewedCommits: string[],
	) => Promise<void>;
	resumeSession: (sessionId: string) => Promise<void>;
	discardExistingSession: (sessionId: string) => Promise<void>;
	endSession: () => Promise<void>;
	clearSession: () => void;
	checkExistingSessions: () => Promise<void>;
	addComment: (args: AddCommentArgs) => Promise<void>;
	toggleResolved: (commentId: string) => Promise<void>;
	deleteComment: (commentId: string) => Promise<void>;
	exportSession: () => Promise<string>;
	setSummary: (summary: string) => Promise<void>;
	toggleEditMode: () => void;
	startComment: (file: string, startLine: number, endLine: number, side: "old" | "new") => void;
	cancelComment: () => void;
	scrollToComment: (file: string, line: number, side: "old" | "new") => void;
	clearScrollTarget: () => void;
}

export interface PendingComment {
	file: string;
	startLine: number;
	endLine: number;
	side: "old" | "new";
}

export interface ScrollTarget {
	file: string;
	line: number;
	side: "old" | "new";
}

// Tracks when the current session was created/resumed, for duration_ms in session_ended.
let sessionStartTime: number | null = null;

export const useReviewStore = create<ReviewState>((set, get) => ({
	session: null,
	isSessionActive: false,
	editMode: false,
	pendingComment: null,
	scrollTarget: null,
	existingSessionIds: [],

	startSession: async (branch, baseCommit, headCommit, reviewedCommits) => {
		try {
			const session = await api.createSession(branch, baseCommit, headCommit, reviewedCommits);
			sessionStartTime = Date.now();
			diag.sessionCreated();
			set({ session, isSessionActive: true, existingSessionIds: [] });
		} catch (e) {
			console.error("Failed to create session:", e);
		}
	},

	resumeSession: async (sessionId) => {
		try {
			const session = await api.loadSession(sessionId);
			sessionStartTime = Date.now();
			diag.sessionLoaded();
			set({ session, isSessionActive: true, existingSessionIds: [] });

			// Restore commit selection from the session
			const includeWt = session.session.head_commit === "WORKING_TREE";
			useSelectionStore.getState().restoreSelection(
				session.session.reviewed_commits,
				includeWt,
			);
		} catch (e) {
			console.error("Failed to load session:", e);
		}
	},

	endSession: async () => {
		const { session } = get();
		if (session) {
			const durationMs = sessionStartTime ? Date.now() - sessionStartTime : 0;
			diag.sessionEnded(session.comments.length, session.edits.length, durationMs);
			sessionStartTime = null;
		}
		try {
			await api.endSession();
		} catch (e) {
			console.error("Failed to end session:", e);
		}
		set({ session: null, isSessionActive: false, editMode: false, pendingComment: null });
		// Refresh the list so remaining unfinished sessions still show
		try {
			const ids = await api.listActiveSessions();
			set({ existingSessionIds: ids });
		} catch { /* ignore */ }
	},

	// Clear without renaming file — used when switching repos
	clearSession: () => {
		const { session } = get();
		if (session !== null) {
			diag.sessionAbandoned(session.comments.length, session.edits.length);
		}
		sessionStartTime = null;
		set({ session: null, isSessionActive: false, editMode: false, pendingComment: null, existingSessionIds: [] });
	},

	discardExistingSession: async (sessionId) => {
		try {
			await api.discardSession(sessionId);
		} catch (e) {
			console.error("Failed to discard session:", e);
		}
		set({ existingSessionIds: get().existingSessionIds.filter((id) => id !== sessionId) });
	},

	checkExistingSessions: async () => {
		try {
			const ids = await api.listActiveSessions();
			set({ existingSessionIds: ids });
		} catch {
			set({ existingSessionIds: [] });
		}
	},

	addComment: async (args) => {
		try {
			const session = await api.addComment(args);
			diag.commentAdded(args.severity, args.comment_type);
			set({ session, pendingComment: null });
		} catch (e) {
			console.error("Failed to add comment:", e);
		}
	},

	toggleResolved: async (commentId) => {
		try {
			const session = await api.toggleCommentResolved(commentId);
			diag.commentResolved();
			set({ session });
		} catch (e) {
			console.error("Failed to toggle resolved:", e);
		}
	},

	deleteComment: async (commentId) => {
		try {
			const session = await api.deleteComment(commentId);
			diag.commentDeleted();
			set({ session });
		} catch (e) {
			console.error("Failed to delete comment:", e);
		}
	},

	exportSession: async () => {
		const result = await api.exportSession();
		diag.sessionExported();
		return result;
	},

	setSummary: async (summary) => {
		try {
			const session = await api.setSessionSummary(summary);
			set({ session });
		} catch (e) {
			console.error("Failed to set summary:", e);
		}
	},

	toggleEditMode: () => {
		set((s) => ({ editMode: !s.editMode }));
	},

	startComment: (file, startLine, endLine, side) => {
		set({ pendingComment: { file, startLine, endLine, side } });
	},

	cancelComment: () => {
		set({ pendingComment: null });
	},

	scrollToComment: (file, line, side) => {
		// Ensure the file is selected/loaded before scrolling
		useSelectionStore.getState().ensureFileSelected(file);
		set({ scrollTarget: { file, line, side } });
	},

	clearScrollTarget: () => {
		set({ scrollTarget: null });
	},
}));
