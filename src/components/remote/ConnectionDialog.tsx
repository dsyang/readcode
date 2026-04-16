import { useEffect, useState } from "react";
import type { ConnectionProfile } from "../../api/types";
import {
	deleteProfile,
	listProfiles,
	saveProfile,
} from "../../api/remote";
import { useSelectionStore } from "../../stores/selectionStore";

interface ConnectionDialogProps {
	onClose: () => void;
}

function newProfile(): ConnectionProfile {
	return {
		id: crypto.randomUUID(),
		name: "",
		ssh_host: "",
		repo_path: "",
	};
}

export function ConnectionDialog({ onClose }: ConnectionDialogProps) {
	const openRemote = useSelectionStore((s) => s.openRemoteRepository);
	const [profiles, setProfiles] = useState<ConnectionProfile[]>([]);
	const [draft, setDraft] = useState<ConnectionProfile>(newProfile);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [connecting, setConnecting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		listProfiles()
			.then(setProfiles)
			.catch((e) => setError(String(e)));
	}, []);

	const isEditing = editingId !== null;
	const draftValid =
		draft.name.trim() &&
		draft.ssh_host.trim() &&
		draft.repo_path.trim();

	async function handleSave() {
		if (!draftValid) return;
		try {
			const updated = await saveProfile(draft);
			setProfiles(updated);
			setDraft(newProfile());
			setEditingId(null);
		} catch (e) {
			setError(String(e));
		}
	}

	async function handleConnect(profile: ConnectionProfile) {
		setConnecting(true);
		setError(null);
		try {
			await openRemote(
				profile.ssh_host,
				profile.repo_path,
				profile.name,
			);
			onClose();
		} catch (e) {
			setError(String(e));
		} finally {
			setConnecting(false);
		}
	}

	async function handleDelete(id: string) {
		try {
			const updated = await deleteProfile(id);
			setProfiles(updated);
			if (editingId === id) {
				setDraft(newProfile());
				setEditingId(null);
			}
		} catch (e) {
			setError(String(e));
		}
	}

	function handleEdit(profile: ConnectionProfile) {
		setDraft({ ...profile });
		setEditingId(profile.id);
	}

	return (
		<div
			className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
			onClick={onClose}
		>
			<div
				className="bg-zinc-800 border border-zinc-700 rounded-lg shadow-2xl w-[560px] max-h-[80vh] overflow-y-auto"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="flex items-center justify-between px-5 py-3 border-b border-zinc-700">
					<h2 className="text-sm font-semibold text-white">Remote Connection</h2>
					<button
						onClick={onClose}
						className="text-zinc-400 hover:text-white text-lg leading-none"
					>
						×
					</button>
				</div>

				<div className="px-5 py-4">
					{error && (
						<div className="mb-3 p-2 bg-red-900/40 border border-red-800 text-red-300 text-xs rounded">
							{error}
						</div>
					)}

					{profiles.length > 0 && (
						<div className="mb-4">
							<div className="text-xs text-zinc-500 mb-2">Saved profiles</div>
							<div className="space-y-1">
								{profiles.map((p) => (
									<div
										key={p.id}
										className="flex items-center gap-2 px-3 py-2 bg-zinc-900 rounded border border-zinc-700"
									>
										<div className="flex-1 min-w-0">
											<div className="text-sm text-white font-medium truncate">
												{p.name}
											</div>
											<div className="text-xs text-zinc-500 truncate">
												{p.ssh_host}
											</div>
											<div className="text-xs text-zinc-600 truncate">
												{p.repo_path}
											</div>
										</div>
										<button
											onClick={() => handleConnect(p)}
											disabled={connecting}
											className="px-3 py-1 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-600 text-white text-xs rounded"
										>
											{connecting ? "..." : "Connect"}
										</button>
										<button
											onClick={() => handleEdit(p)}
											className="px-2 py-1 text-zinc-400 hover:text-white text-xs"
										>
											Edit
										</button>
										<button
											onClick={() => handleDelete(p.id)}
											className="px-2 py-1 text-zinc-500 hover:text-red-400 text-xs"
										>
											Delete
										</button>
									</div>
								))}
							</div>
						</div>
					)}

					<div>
						<div className="text-xs text-zinc-500 mb-2">
							{isEditing ? "Edit profile" : "New profile"}
						</div>
						<div className="space-y-2">
							<input
								type="text"
								placeholder="Name (e.g. My Dev Server)"
								value={draft.name}
								onChange={(e) =>
									setDraft({ ...draft, name: e.target.value })
								}
								className="w-full px-3 py-1.5 bg-zinc-900 border border-zinc-700 rounded text-sm text-white placeholder-zinc-600"
							/>
							<input
								type="text"
								placeholder="SSH host (e.g. myserver.example.com)"
								value={draft.ssh_host}
								onChange={(e) =>
									setDraft({ ...draft, ssh_host: e.target.value })
								}
								className="w-full px-3 py-1.5 bg-zinc-900 border border-zinc-700 rounded text-sm text-white placeholder-zinc-600 font-mono"
							/>
							<input
								type="text"
								placeholder="Remote repo path (e.g. /home/user/project)"
								value={draft.repo_path}
								onChange={(e) =>
									setDraft({ ...draft, repo_path: e.target.value })
								}
								className="w-full px-3 py-1.5 bg-zinc-900 border border-zinc-700 rounded text-sm text-white placeholder-zinc-600 font-mono"
							/>
							<div className="flex gap-2 justify-end">
								{isEditing && (
									<button
										onClick={() => {
											setDraft(newProfile());
											setEditingId(null);
										}}
										className="px-3 py-1 text-zinc-400 hover:text-white text-xs"
									>
										Cancel
									</button>
								)}
								<button
									onClick={handleSave}
									disabled={!draftValid}
									className="px-3 py-1 bg-zinc-700 hover:bg-zinc-600 disabled:bg-zinc-800 disabled:text-zinc-600 text-white text-xs rounded"
								>
									{isEditing ? "Save" : "Add Profile"}
								</button>
								<button
									onClick={() => draftValid && handleConnect(draft)}
									disabled={!draftValid || connecting}
									className="px-3 py-1 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-600 text-white text-xs rounded"
								>
									{connecting ? "Connecting..." : "Connect"}
								</button>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
