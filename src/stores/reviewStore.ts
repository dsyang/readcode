import { create } from "zustand";
import type { ReviewSession, AddCommentArgs } from "../api/reviewTypes";
import * as api from "../api/review";
import { useSelectionStore } from "./selectionStore";

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

export const useReviewStore = create<ReviewState>((set) => ({
	session: null,
	isSessionActive: false,
	editMode: false,
	pendingComment: null,
	scrollTarget: null,
	existingSessionIds: [],

	startSession: async (branch, baseCommit, headCommit, reviewedCommits) => {
		try {
			const session = await api.createSession(branch, baseCommit, headCommit, reviewedCommits);
			set({ session, isSessionActive: true, existingSessionIds: [] });
		} catch (e) {
			console.error("Failed to create session:", e);
		}
	},

	resumeSession: async (sessionId) => {
		try {
			const session = await api.loadSession(sessionId);
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
		try {
			await api.endSession();
		} catch (e) {
			console.error("Failed to end session:", e);
		}
		set({ session: null, isSessionActive: false, editMode: false, pendingComment: null });
	},

	// Clear without renaming file — used when switching repos
	clearSession: () => {
		set({ session: null, isSessionActive: false, editMode: false, pendingComment: null, existingSessionIds: [] });
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
			set({ session, pendingComment: null });
		} catch (e) {
			console.error("Failed to add comment:", e);
		}
	},

	toggleResolved: async (commentId) => {
		try {
			const session = await api.toggleCommentResolved(commentId);
			set({ session });
		} catch (e) {
			console.error("Failed to toggle resolved:", e);
		}
	},

	deleteComment: async (commentId) => {
		try {
			const session = await api.deleteComment(commentId);
			set({ session });
		} catch (e) {
			console.error("Failed to delete comment:", e);
		}
	},

	exportSession: async () => {
		return api.exportSession();
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
