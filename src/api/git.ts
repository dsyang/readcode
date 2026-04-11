import { invoke } from "@tauri-apps/api/core";
import type { CommitInfo, CommitRange, FileDiffContent, MergedDiff, RepoInfo } from "./types";

export async function openRepo(path: string): Promise<RepoInfo> {
	return invoke<RepoInfo>("open_repo", { path });
}

export async function getCommits(maxCount?: number): Promise<CommitInfo[]> {
	return invoke<CommitInfo[]>("get_commits", { maxCount: maxCount ?? 50 });
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
