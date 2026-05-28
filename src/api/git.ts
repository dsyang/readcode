import { invoke } from "@tauri-apps/api/core";
import type { CommitInfo, CommitRange, FileDiffContent, MergedDiff, RepoInfo } from "./types";

export async function openRepo(path: string): Promise<RepoInfo> {
	return invoke<RepoInfo>("open_repo", { path });
}

export async function getCommits(maxCount?: number): Promise<CommitInfo[]> {
	return invoke<CommitInfo[]>("get_commits", { maxCount: maxCount ?? 50 });
}

export async function getCommitMessage(oid: string): Promise<string> {
	return invoke<string>("get_commit_message", { oid });
}

export async function getMergedDiff(range: CommitRange): Promise<MergedDiff> {
	return invoke<MergedDiff>("get_merged_diff", { range });
}

export async function getFileDiffContent(
	path: string,
	range: CommitRange,
): Promise<FileDiffContent> {
	return invoke<FileDiffContent>("get_file_diff_content", { path, range });
}

export async function getFileAtRevision(
	path: string,
	rev: string,
): Promise<string> {
	return invoke<string>("get_file_at_revision", { path, rev });
}

export async function writeFileToWorkdir(
	path: string,
	content: string,
): Promise<void> {
	return invoke<void>("write_file_to_workdir", { path, content });
}

export async function createBranch(name: string, oid: string): Promise<void> {
	return invoke<void>("create_branch", { name, oid });
}
