import { useSelectionStore } from "../../stores/selectionStore";
import type { DiffFile, FileStatus } from "../../api/types";

export function FileList() {
	const mergedDiff = useSelectionStore((s) => s.mergedDiff);
	const selectedFilePaths = useSelectionStore((s) => s.selectedFilePaths);
	const handleFileClick = useSelectionStore((s) => s.handleFileClick);

	if (!mergedDiff) {
		return (
			<div className="flex items-center justify-center h-full text-zinc-500 text-sm p-4">
				Select commits to see changed files
			</div>
		);
	}

	return (
		<div className="overflow-y-auto h-full">
			<div className="px-3 py-1.5 text-xs text-zinc-500 border-b border-zinc-700">
				{mergedDiff.files.length} file{mergedDiff.files.length !== 1 ? "s" : ""} changed
				{selectedFilePaths.size > 0 && selectedFilePaths.size < mergedDiff.files.length && (
					<span className="ml-1">({selectedFilePaths.size} selected)</span>
				)}
			</div>
			{mergedDiff.files.map((file) => (
				<FileRow
					key={file.path}
					file={file}
					isSelected={selectedFilePaths.has(file.path)}
					onClick={handleFileClick}
				/>
			))}
		</div>
	);
}

interface FileRowProps {
	file: DiffFile;
	isSelected: boolean;
	onClick: (path: string, metaKey: boolean, shiftKey: boolean) => void;
}

function FileRow({ file, isSelected, onClick }: FileRowProps) {
	const statusColor = getStatusColor(file.status);
	const statusChar = file.status[0];
	const fileName = file.path.split("/").pop() ?? file.path;
	const dirPath = file.path.includes("/")
		? file.path.substring(0, file.path.lastIndexOf("/"))
		: "";

	return (
		<div
			onClick={(e) => onClick(file.path, e.metaKey || e.ctrlKey, e.shiftKey)}
			className={`flex items-center gap-2 px-3 py-1 cursor-pointer text-sm ${
				isSelected
					? "bg-blue-900/40 text-white"
					: "text-zinc-300 hover:bg-zinc-800"
			}`}
		>
			<span className={`font-mono text-xs font-bold w-4 ${statusColor}`}>
				{statusChar}
			</span>
			<span className="truncate flex-1">
				<span className="text-zinc-400">{dirPath ? dirPath + "/" : ""}</span>
				<span>{fileName}</span>
			</span>
			<span className="text-xs flex-shrink-0 flex gap-1">
				{file.additions > 0 && (
					<span className="text-green-400">+{file.additions}</span>
				)}
				{file.deletions > 0 && (
					<span className="text-red-400">-{file.deletions}</span>
				)}
			</span>
		</div>
	);
}

function getStatusColor(status: FileStatus): string {
	switch (status) {
		case "Added": return "text-green-400";
		case "Deleted": return "text-red-400";
		case "Modified": return "text-yellow-400";
		case "Renamed": return "text-blue-400";
		case "Copied": return "text-purple-400";
	}
}
