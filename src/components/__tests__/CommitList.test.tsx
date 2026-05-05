import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useSelectionStore } from "../../stores/selectionStore";
import { useReviewStore } from "../../stores/reviewStore";
import { setupStandardRepo } from "../../test/tauriMock";
import { CommitList } from "../graph/CommitList";

async function waitForState(predicate: () => boolean, timeoutMs = 2000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitForState timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("CommitList", () => {
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
  });

  it("shows empty state when no repo is open", () => {
    render(<CommitList />);
    expect(screen.getByText("Open a repository to see commits")).toBeInTheDocument();
  });

  it("renders commit summaries after opening repo", async () => {
    setupStandardRepo(3);
    await useSelectionStore.getState().openRepository("/mock/repo");
    await waitForState(() => useSelectionStore.getState().commits.length > 0);

    render(<CommitList />);
    expect(screen.getByText("3 commits")).toBeInTheDocument();
    expect(screen.getByText("Commit message 0")).toBeInTheDocument();
    expect(screen.getByText("Commit message 1")).toBeInTheDocument();
    expect(screen.getByText("Commit message 2")).toBeInTheDocument();
  });

  it("shows branch labels on head commit", async () => {
    setupStandardRepo(2);
    await useSelectionStore.getState().openRepository("/mock/repo");
    await waitForState(() => useSelectionStore.getState().commits.length > 0);

    render(<CommitList />);
    expect(screen.getByText("main")).toBeInTheDocument();
  });

  it("clicking a commit selects it", async () => {
    setupStandardRepo(3);
    await useSelectionStore.getState().openRepository("/mock/repo");
    await waitForState(() => useSelectionStore.getState().commits.length > 0);

    render(<CommitList />);
    fireEvent.click(screen.getByText("Commit message 1"));

    const oid = useSelectionStore.getState().commits[1].oid;
    expect(useSelectionStore.getState().selectedCommitOids.has(oid)).toBe(true);
  });

  it("shows selection count and clear button", async () => {
    setupStandardRepo(3);
    await useSelectionStore.getState().openRepository("/mock/repo");
    await waitForState(() => useSelectionStore.getState().commits.length > 0);

    render(<CommitList />);
    fireEvent.click(screen.getByText("Commit message 0"));

    expect(screen.getByText("(1 selected)")).toBeInTheDocument();
    expect(screen.getByText("clear")).toBeInTheDocument();
  });

  it("clear button deselects all commits", async () => {
    setupStandardRepo(3);
    await useSelectionStore.getState().openRepository("/mock/repo");
    await waitForState(() => useSelectionStore.getState().commits.length > 0);

    render(<CommitList />);
    fireEvent.click(screen.getByText("Commit message 0"));
    fireEvent.click(screen.getByText("clear"));

    expect(useSelectionStore.getState().selectedCommitOids.size).toBe(0);
  });

  it("renders Working Tree row", async () => {
    setupStandardRepo(2);
    await useSelectionStore.getState().openRepository("/mock/repo");
    await waitForState(() => useSelectionStore.getState().commits.length > 0);

    render(<CommitList />);
    expect(screen.getByText("Working Tree")).toBeInTheDocument();
  });
});
