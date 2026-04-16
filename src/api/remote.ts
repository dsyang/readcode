import { invoke } from "@tauri-apps/api/core";
import type { ConnectionProfile, RepoInfo } from "./types";

export async function openRemoteRepo(
	sshHost: string,
	repoPath: string,
): Promise<RepoInfo> {
	return invoke<RepoInfo>("open_remote_repo", {
		sshHost,
		repoPath,
	});
}

export async function disconnectRemote(): Promise<void> {
	return invoke<void>("disconnect_remote");
}

export async function listProfiles(): Promise<ConnectionProfile[]> {
	return invoke<ConnectionProfile[]>("list_profiles");
}

export async function saveProfile(
	profile: ConnectionProfile,
): Promise<ConnectionProfile[]> {
	return invoke<ConnectionProfile[]>("save_profile", { profile });
}

export async function deleteProfile(id: string): Promise<ConnectionProfile[]> {
	return invoke<ConnectionProfile[]>("delete_profile", { id });
}
