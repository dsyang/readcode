import type {
  CommitInfo,
  CommitRange,
  DiffFile,
  FileDiffContent,
  FileStatus,
  MergedDiff,
  RepoInfo,
} from "../api/types";
import type { ReviewSession, AddCommentArgs, AddEditArgs } from "../api/reviewTypes";

// ── In-memory state that models the Rust backend ───────────��────────

interface MockRepo {
  workdir: string;
  current_branch: string | null;
  commits: CommitInfo[];
  files: Record<string, Record<string, string>>; // oid -> { path: content }
  workdirFiles: Record<string, string>;
}

export interface MockFileFixture {
  path: string;
  oldContent: string;
  newContent: string;
  status?: FileStatus;
}

export interface IpcInvocation {
  cmd: string;
  args?: Record<string, unknown>;
}

interface MockState {
  repo: MockRepo | null;
  session: ReviewSession | null;
  activeSessions: Map<string, ReviewSession>;
  nextCommentId: number;
  nextEditId: number;
  multiFileRepo: Map<string, MockFileFixture> | null;
  invocations: IpcInvocation[];
}

let state: MockState = freshState();

function freshState(): MockState {
  return {
    repo: null,
    session: null,
    activeSessions: new Map(),
    nextCommentId: 1,
    nextEditId: 1,
    multiFileRepo: null,
    invocations: [],
  };
}

export function resetMockState() {
  state = freshState();
}

// ── Helpers to set up test scenarios ────────────────────────────────

export function setMockRepo(repo: MockRepo) {
  state.repo = repo;
}

export function setMockSession(session: ReviewSession) {
  state.session = session;
  state.activeSessions.set(session.session.id, session);
}

export function getMockSession(): ReviewSession | null {
  return state.session;
}

export function createSampleCommits(count: number): CommitInfo[] {
  const commits: CommitInfo[] = [];
  for (let i = 0; i < count; i++) {
    const oid = `commit${String(i).padStart(3, "0")}${"0".repeat(33)}`;
    commits.push({
      oid,
      short_oid: oid.substring(0, 7),
      parent_oids: i < count - 1 ? [`commit${String(i + 1).padStart(3, "0")}${"0".repeat(33)}`] : [],
      author_name: "Test User",
      author_email: "test@example.com",
      timestamp: Date.now() / 1000 - i * 3600,
      summary: `Commit message ${i}`,
      branches: i === 0 ? ["main"] : [],
      tags: [],
      is_head: i === 0,
      lane: 0,
      edges: i < count - 1 ? [{ from_lane: 0, to_lane: 0, color: 0 }] : [],
      lane_count: 1,
    });
  }
  return commits;
}

/// Set up a fixture where get_merged_diff / get_file_diff_content return the
/// given multi-file payload keyed by path. Pass to test scenarios that need
/// to drive DiffView with more than the default single-file `main.rs` mock.
export function setupMultiFileRepo(opts: { files: MockFileFixture[] }): void {
  state.multiFileRepo = new Map(opts.files.map((f) => [f.path, f]));
  if (!state.repo) {
    setupStandardRepo();
  }
}

export function getInvocations(): IpcInvocation[] {
  return state.invocations;
}

export function getInvocationsFor(cmd: string): IpcInvocation[] {
  return state.invocations.filter((i) => i.cmd === cmd);
}

export function clearInvocations(): void {
  state.invocations = [];
}

export function setupStandardRepo(commitCount = 5): MockRepo {
  const commits = createSampleCommits(commitCount);
  const files: Record<string, Record<string, string>> = {};
  for (const c of commits) {
    files[c.oid] = { "main.rs": `content at ${c.short_oid}` };
  }
  const repo: MockRepo = {
    workdir: "/mock/repo/",
    current_branch: "main",
    commits,
    files,
    workdirFiles: { "main.rs": "workdir content" },
  };
  setMockRepo(repo);
  return repo;
}

// ── The mock invoke handler ─────────────────────────────────────────

export async function mockTauriInvoke(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<unknown> {
  state.invocations.push({ cmd, args });
  switch (cmd) {
    case "open_repo": {
      if (!state.repo) {
        state.repo = {
          workdir: (args?.path as string) ?? "/mock/repo/",
          current_branch: "main",
          commits: createSampleCommits(5),
          files: {},
          workdirFiles: {},
        };
      }
      return {
        workdir: state.repo.workdir,
        current_branch: state.repo.current_branch,
      } satisfies RepoInfo;
    }

    case "open_remote_repo": {
      const sshHost = args?.sshHost as string;
      const repoPath = args?.repoPath as string;
      if (!state.repo) {
        state.repo = {
          workdir: `${sshHost}:${repoPath}`,
          current_branch: "main",
          commits: createSampleCommits(3),
          files: {},
          workdirFiles: {},
        };
      }
      return {
        workdir: state.repo.workdir,
        current_branch: state.repo.current_branch,
      } satisfies RepoInfo;
    }

    case "disconnect_remote":
      state.repo = null;
      return;

    case "get_commits": {
      if (!state.repo) throw new Error("No repository is open");
      const max = (args?.maxCount as number) ?? 50;
      return state.repo.commits.slice(0, max);
    }

    case "get_commit_message": {
      return `Full message for ${args?.oid}`;
    }

    case "get_merged_diff": {
      if (!state.repo) throw new Error("No repository is open");
      const range = args?.range as CommitRange;
      const files: DiffFile[] = state.multiFileRepo
        ? Array.from(state.multiFileRepo.values()).map((f) => ({
            path: f.path,
            status: f.status ?? "Modified",
            old_path: null,
            additions: 0,
            deletions: 0,
          }))
        : [
            {
              path: "main.rs",
              status: "Modified",
              old_path: null,
              additions: 5,
              deletions: 2,
            },
          ];
      return {
        files,
        base_oid: range.commits.length > 0 ? "base000" : null,
        head_description: range.include_working_tree
          ? "Working Tree"
          : range.commits[range.commits.length - 1]?.substring(0, 7) ?? "",
      } satisfies MergedDiff;
    }

    case "get_file_diff_content": {
      const path = args?.path as string;
      const fixture = state.multiFileRepo?.get(path);
      if (fixture) {
        return {
          path,
          old_content: fixture.oldContent,
          new_content: fixture.newContent,
          status: fixture.status ?? "Modified",
        } satisfies FileDiffContent;
      }
      return {
        path,
        old_content: "old content",
        new_content: "new content",
        status: "Modified",
      } satisfies FileDiffContent;
    }

    case "get_file_at_revision":
      return `content of ${args?.path} at ${args?.rev}`;

    case "write_file_to_workdir":
      return;

    // ── Review commands ──────────────────────────────────────────
    case "create_session": {
      const now = new Date().toISOString();
      const session: ReviewSession = {
        version: "1.0",
        session: {
          id: `mock-session-${Date.now()}`,
          repo: state.repo?.workdir ?? "/mock",
          review_location: "local",
          branch: (args?.branch as string) ?? null,
          base_commit: (args?.baseCommit as string) ?? null,
          head_commit: (args?.headCommit as string) ?? "HEAD",
          reviewed_commits: (args?.reviewedCommits as string[]) ?? [],
          created_at: now,
          updated_at: now,
        },
        comments: [],
        edits: [],
        summary: null,
      };
      state.session = session;
      state.activeSessions.set(session.session.id, session);
      return session;
    }

    case "get_session":
      return state.session;

    case "load_session": {
      const sid = args?.sessionId as string;
      const s = state.activeSessions.get(sid);
      if (!s) throw new Error(`Session not found: ${sid}`);
      state.session = s;
      return s;
    }

    case "list_active_sessions":
      return Array.from(state.activeSessions.keys());

    case "discard_session": {
      const sid = args?.sessionId as string;
      state.activeSessions.delete(sid);
      return;
    }

    case "end_session": {
      if (state.session) {
        state.activeSessions.delete(state.session.session.id);
      }
      state.session = null;
      return;
    }

    case "add_comment": {
      if (!state.session) throw new Error("No active session");
      const a = args?.args as AddCommentArgs;
      const id = `comment-${state.nextCommentId++}`;
      state.session.comments.push({
        id,
        type: a.comment_type,
        file: a.file,
        line_range: { side: a.side, start: a.start_line, end: a.end_line },
        body: a.body,
        severity: a.severity,
        resolved: false,
        created_at: new Date().toISOString(),
        context: { before: a.context_before, content: a.context_content, after: a.context_after },
      });
      state.session.session.updated_at = new Date().toISOString();
      return { ...state.session };
    }

    case "toggle_comment_resolved": {
      if (!state.session) throw new Error("No active session");
      const cid = args?.commentId as string;
      const comment = state.session.comments.find((c) => c.id === cid);
      if (comment) comment.resolved = !comment.resolved;
      state.session.session.updated_at = new Date().toISOString();
      return { ...state.session };
    }

    case "delete_comment": {
      if (!state.session) throw new Error("No active session");
      const cid = args?.commentId as string;
      state.session.comments = state.session.comments.filter((c) => c.id !== cid);
      state.session.session.updated_at = new Date().toISOString();
      return { ...state.session };
    }

    case "add_edit": {
      if (!state.session) throw new Error("No active session");
      const e = args?.args as AddEditArgs;
      const id = `edit-${state.nextEditId++}`;
      state.session.edits.push({
        id,
        file: e.file,
        line_range: { start: e.start_line, end: e.end_line },
        old_content: e.old_content,
        new_content: e.new_content,
        description: e.description,
        applied_at: new Date().toISOString(),
        associated_comment_id: e.associated_comment_id,
      });
      state.session.session.updated_at = new Date().toISOString();
      return { ...state.session };
    }

    case "export_session": {
      if (!state.session) throw new Error("No active session");
      return JSON.stringify(state.session, null, 2);
    }

    case "set_session_summary": {
      if (!state.session) throw new Error("No active session");
      state.session.summary = (args?.summary as string) || null;
      return { ...state.session };
    }

    // ── Remote/profile commands ──────────────────────────────────
    case "list_profiles":
      return [];
    case "save_profile":
      return [];
    case "delete_profile":
      return [];

    // ── Diagnostics (fire-and-forget, just return) ───────────────
    case "log_event":
    case "hash_string":
    case "hash_string_cmd":
      return "abcd1234";

    default:
      console.warn(`[tauriMock] unhandled command: ${cmd}`);
      return null;
  }
}
