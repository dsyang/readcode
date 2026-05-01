import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useSelectionStore } from "../../stores/selectionStore";
import { useReviewStore } from "../../stores/reviewStore";
import { setupStandardRepo } from "../../test/tauriMock";
import { Toolbar } from "../layout/Toolbar";

async function waitForState(predicate: () => boolean, timeoutMs = 2000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitForState timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}

const defaultProps = {
  sidebarVisible: true,
  onToggleSidebar: vi.fn(),
  reviewPanelVisible: true,
  onToggleReviewPanel: vi.fn(),
};

describe("Toolbar", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
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

  it("shows Open Repo when no repo is open", () => {
    render(<Toolbar {...defaultProps} />);
    expect(screen.getByText("Open Repo")).toBeInTheDocument();
  });

  it("shows repo name when repo is open", async () => {
    setupStandardRepo();
    await useSelectionStore.getState().openRepository("/mock/repo");
    await waitForState(() => useSelectionStore.getState().commits.length > 0);

    render(<Toolbar {...defaultProps} />);
    expect(screen.getByText("repo")).toBeInTheDocument();
  });

  it("calls sidebar toggle callback", () => {
    render(<Toolbar {...defaultProps} />);
    const toggleBtn = screen.getByTitle("Hide sidebar");
    fireEvent.click(toggleBtn);
    expect(defaultProps.onToggleSidebar).toHaveBeenCalledOnce();
  });

  it("calls review panel toggle callback", () => {
    render(<Toolbar {...defaultProps} />);
    const toggleBtn = screen.getByTitle("Hide review panel");
    fireEvent.click(toggleBtn);
    expect(defaultProps.onToggleReviewPanel).toHaveBeenCalledOnce();
  });

  it("shows REMOTE badge for remote connections", async () => {
    setupStandardRepo();
    useSelectionStore.setState({
      repoPath: "host:/path/repo",
      connectionMode: "remote",
      remoteProfileName: "myprofile",
      commits: useSelectionStore.getState().commits.length > 0
        ? useSelectionStore.getState().commits
        : [],
    });

    // Open repo to populate commits
    await useSelectionStore.getState().openRepository("/mock/repo");
    await waitForState(() => useSelectionStore.getState().commits.length > 0);
    useSelectionStore.setState({ connectionMode: "remote" });

    render(<Toolbar {...defaultProps} />);
    expect(screen.getByText("REMOTE")).toBeInTheDocument();
  });
});
