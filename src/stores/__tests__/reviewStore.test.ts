import { describe, it, expect, beforeEach } from "vitest";
import { useReviewStore } from "../reviewStore";
import { useSelectionStore } from "../selectionStore";
import { setupStandardRepo } from "../../test/tauriMock";

function getReviewState() {
  return useReviewStore.getState();
}

async function waitForReview(predicate: () => boolean, timeoutMs = 2000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitForReview timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("reviewStore", () => {
  beforeEach(async () => {
    // Reset review store
    useReviewStore.setState({
      session: null,
      isSessionActive: false,
      editMode: false,
      pendingComment: null,
      scrollTarget: null,
      existingSessionIds: [],
    });
    // Reset selection store
    useSelectionStore.setState({
      repoPath: null,
      currentBranch: null,
      connectionMode: null,
      remoteProfileName: null,
      commits: [],
      isLoading: false,
      error: null,
      recentRepos: [],
      selectedCommitOids: new Set(),
      lastClickedCommitOid: null,
      includeWorkingTree: false,
      mergedDiff: null,
      selectedFilePaths: new Set(),
      lastClickedFilePath: null,
      fileDiffContents: new Map(),
      isDiffLoading: false,
    });

    // Open a repo so review commands work
    setupStandardRepo();
    await useSelectionStore.getState().openRepository("/mock/repo");
    await waitForReview(() => useSelectionStore.getState().commits.length > 0);
  });

  describe("session lifecycle", () => {
    it("startSession creates an active session", async () => {
      await getReviewState().startSession("main", "base123", "head456", ["c1", "c2"]);
      const s = getReviewState();
      expect(s.isSessionActive).toBe(true);
      expect(s.session).not.toBeNull();
      expect(s.session!.version).toBe("1.0");
      expect(s.session!.comments).toHaveLength(0);
      expect(s.session!.edits).toHaveLength(0);
    });

    it("endSession clears the session", async () => {
      await getReviewState().startSession("main", null, "head", []);
      expect(getReviewState().isSessionActive).toBe(true);

      await getReviewState().endSession();
      const s = getReviewState();
      expect(s.session).toBeNull();
      expect(s.isSessionActive).toBe(false);
      expect(s.editMode).toBe(false);
    });

    it("clearSession clears without ending", async () => {
      await getReviewState().startSession("main", null, "head", []);
      getReviewState().clearSession();
      expect(getReviewState().session).toBeNull();
      expect(getReviewState().isSessionActive).toBe(false);
    });
  });

  describe("comments", () => {
    beforeEach(async () => {
      await getReviewState().startSession("main", null, "head", ["c1"]);
    });

    it("addComment appends to session", async () => {
      await getReviewState().addComment({
        file: "main.rs",
        side: "new",
        start_line: 10,
        end_line: 15,
        body: "looks good",
        comment_type: "comment",
        severity: "info",
        context_before: "fn main() {",
        context_content: 'println!("hi");',
        context_after: "}",
      });
      const s = getReviewState();
      expect(s.session!.comments).toHaveLength(1);
      expect(s.session!.comments[0].body).toBe("looks good");
      expect(s.session!.comments[0].resolved).toBe(false);
      expect(s.pendingComment).toBeNull();
    });

    it("toggleResolved flips the resolved state", async () => {
      await getReviewState().addComment({
        file: "f.rs",
        side: "new",
        start_line: 1,
        end_line: 1,
        body: "fix this",
        comment_type: "issue",
        severity: "warning",
        context_before: "",
        context_content: "",
        context_after: "",
      });
      const commentId = getReviewState().session!.comments[0].id;

      await getReviewState().toggleResolved(commentId);
      expect(getReviewState().session!.comments[0].resolved).toBe(true);

      await getReviewState().toggleResolved(commentId);
      expect(getReviewState().session!.comments[0].resolved).toBe(false);
    });

    it("deleteComment removes from session", async () => {
      await getReviewState().addComment({
        file: "f.rs",
        side: "old",
        start_line: 5,
        end_line: 5,
        body: "delete me",
        comment_type: "comment",
        severity: "info",
        context_before: "",
        context_content: "",
        context_after: "",
      });
      const commentId = getReviewState().session!.comments[0].id;

      await getReviewState().deleteComment(commentId);
      expect(getReviewState().session!.comments).toHaveLength(0);
    });
  });

  describe("exportSession", () => {
    it("returns JSON string of session", async () => {
      await getReviewState().startSession("main", null, "head", []);
      await getReviewState().addComment({
        file: "f.rs",
        side: "new",
        start_line: 1,
        end_line: 1,
        body: "exported",
        comment_type: "suggestion",
        severity: "suggestion",
        context_before: "",
        context_content: "",
        context_after: "",
      });

      const json = await getReviewState().exportSession();
      const parsed = JSON.parse(json);
      expect(parsed.version).toBe("1.0");
      expect(parsed.comments).toHaveLength(1);
      expect(parsed.comments[0].body).toBe("exported");
    });
  });

  describe("edit mode", () => {
    it("toggleEditMode flips state", () => {
      expect(getReviewState().editMode).toBe(false);
      getReviewState().toggleEditMode();
      expect(getReviewState().editMode).toBe(true);
      getReviewState().toggleEditMode();
      expect(getReviewState().editMode).toBe(false);
    });
  });

  describe("pendingComment", () => {
    it("startComment sets pending, cancelComment clears it", () => {
      getReviewState().startComment("main.rs", 10, 15, "new");
      expect(getReviewState().pendingComment).toEqual({
        file: "main.rs",
        startLine: 10,
        endLine: 15,
        side: "new",
      });
      getReviewState().cancelComment();
      expect(getReviewState().pendingComment).toBeNull();
    });
  });

  describe("scrollTarget", () => {
    it("scrollToComment sets target, clearScrollTarget clears it", () => {
      getReviewState().scrollToComment("main.rs", 20, "old");
      expect(getReviewState().scrollTarget).toEqual({
        file: "main.rs",
        line: 20,
        side: "old",
      });
      getReviewState().clearScrollTarget();
      expect(getReviewState().scrollTarget).toBeNull();
    });
  });

  describe("setSummary", () => {
    it("updates session summary", async () => {
      await getReviewState().startSession("main", null, "head", []);
      await getReviewState().setSummary("This is the summary");
      expect(getReviewState().session!.summary).toBe("This is the summary");
    });

    it("empty string sets null summary", async () => {
      await getReviewState().startSession("main", null, "head", []);
      await getReviewState().setSummary("something");
      await getReviewState().setSummary("");
      expect(getReviewState().session!.summary).toBeNull();
    });
  });
});
