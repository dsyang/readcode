import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { useReviewStore } from "../../stores/reviewStore";
import { useSelectionStore } from "../../stores/selectionStore";
import { setupStandardRepo } from "../../test/tauriMock";
import { CommentPanel } from "../review/CommentPanel";

async function waitForState(predicate: () => boolean, timeoutMs = 2000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitForState timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("CommentPanel", () => {
  beforeEach(async () => {
    useReviewStore.setState({
      session: null,
      isSessionActive: false,
      editMode: false,
      pendingComment: null,
      scrollTarget: null,
      existingSessionIds: [],
    });
    useSelectionStore.setState({
      repoPath: "/mock/repo/",
      currentBranch: "main",
      connectionMode: "local",
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

    setupStandardRepo();
    await useSelectionStore.getState().openRepository("/mock/repo");
    await waitForState(() => useSelectionStore.getState().commits.length > 0);
  });

  it("shows Start New Review button when no session active", () => {
    render(<CommentPanel />);
    expect(screen.getByText("Start New Review")).toBeInTheDocument();
  });

  it("shows comment count when session is active", async () => {
    await useReviewStore.getState().startSession("main", null, "head", ["c1"]);
    render(<CommentPanel />);
    expect(screen.getByText(/0 comments/)).toBeInTheDocument();
  });

  it("shows Copy for AI button in active session", async () => {
    await useReviewStore.getState().startSession("main", null, "head", []);
    render(<CommentPanel />);
    expect(screen.getByText("Copy for AI")).toBeInTheDocument();
  });

  it("shows End button in active session", async () => {
    await useReviewStore.getState().startSession("main", null, "head", []);
    render(<CommentPanel />);
    expect(screen.getByText("End")).toBeInTheDocument();
  });

  it("shows comments grouped by file", async () => {
    await useReviewStore.getState().startSession("main", null, "head", []);
    await useReviewStore.getState().addComment({
      file: "src/main.rs",
      side: "new",
      start_line: 10,
      end_line: 15,
      body: "This needs a fix",
      comment_type: "issue",
      severity: "warning",
      context_before: "",
      context_content: "",
      context_after: "",
    });

    render(<CommentPanel />);
    expect(screen.getByText(/1 comment/)).toBeInTheDocument();
    expect(screen.getByText("main.rs")).toBeInTheDocument();
    expect(screen.getByText("This needs a fix")).toBeInTheDocument();
  });

  it("shows summary section", async () => {
    await useReviewStore.getState().startSession("main", null, "head", []);
    render(<CommentPanel />);
    expect(screen.getByText("Summary")).toBeInTheDocument();
    expect(screen.getByText("No summary yet")).toBeInTheDocument();
  });
});
