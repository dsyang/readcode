import { create } from "zustand";
import type { ReviewSession, AddCommentArgs } from "../api/reviewTypes";
import * as api from "../api/review";

interface ReviewState {
	session: ReviewSession | null;
	isSessionActive: boolean;
	editMode: boolean;

	// Pending comment being written
	pendingComment: PendingComment | null;

	// Scroll target: set when user clicks a comment in the panel
	scrollTarget: ScrollTarget | null;

	// Actions
	startSession: (
		branch: string | null,
		baseCommit: string | null,
		headCommit: string,
		reviewedCommits: string[],
	) => Promise<void>;
	endSession: () => void;
	addComment: (args: AddCommentArgs) => Promise<void>;
	toggleResolved: (commentId: string) => Promise<void>;
	deleteComment: (commentId: string) => Promise<void>;
	exportSession: () => Promise<string>;
	setSummary: (summary: string) => Promise<void>;
	toggleEditMode: () => void;

	// Pending comment flow
	startComment: (file: string, startLine: number, endLine: number, side: "old" | "new") => void;
	cancelComment: () => void;

	// Scroll
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

	startSession: async (branch, baseCommit, headCommit, reviewedCommits) => {
		try {
			const session = await api.createSession(branch, baseCommit, headCommit, reviewedCommits);
			set({ session, isSessionActive: true });
		} catch (e) {
			console.error("Failed to create session:", e);
		}
	},

	endSession: () => {
		set({ session: null, isSessionActive: false, editMode: false, pendingComment: null });
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
		set({ scrollTarget: { file, line, side } });
	},

	clearScrollTarget: () => {
		set({ scrollTarget: null });
	},
}));
