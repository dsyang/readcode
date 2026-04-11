export interface CommitInfo {
	oid: string;
	short_oid: string;
	parent_oids: string[];
	author_name: string;
	author_email: string;
	timestamp: number;
	summary: string;
	branches: string[];
	tags: string[];
	is_head: boolean;
	lane: number;
	edges: DagEdge[];
	lane_count: number;
}

export interface DagEdge {
	from_lane: number;
	to_lane: number;
	color: number;
}

export interface RepoInfo {
	workdir: string;
	current_branch: string | null;
}

export interface CommitRange {
	commits: string[];
	include_working_tree: boolean;
}

export interface DiffFile {
	path: string;
	status: FileStatus;
	old_path: string | null;
	additions: number;
	deletions: number;
}

export type FileStatus = "Added" | "Deleted" | "Modified" | "Renamed" | "Copied";

export interface MergedDiff {
	files: DiffFile[];
	base_oid: string | null;
	head_description: string;
}

export interface FileDiffContent {
	path: string;
	old_content: string;
	new_content: string;
	status: FileStatus;
}
