import { useEffect, useRef, useState } from "react";
import { MergeView } from "@codemirror/merge";
import { EditorView, lineNumbers } from "@codemirror/view";
import { Compartment, EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { useSelectionStore } from "../../stores/selectionStore";
import { useReviewStore } from "../../stores/reviewStore";
import { getLanguageExtension } from "./languages";
import { commentGutter } from "./commentGutter";
import { writeFileToWorkdir } from "../../api/git";
import type { FileDiffContent } from "../../api/types";

export function DiffView() {
	const selectedFilePaths = useSelectionStore((s) => s.selectedFilePaths);
	const fileDiffContents = useSelectionStore((s) => s.fileDiffContents);
	const mergedDiff = useSelectionStore((s) => s.mergedDiff);
	const isDiffLoading = useSelectionStore((s) => s.isDiffLoading);
	const editMode = useReviewStore((s) => s.editMode);
	const toggleEditMode = useReviewStore((s) => s.toggleEditMode);
	const isSessionActive = useReviewStore((s) => s.isSessionActive);

	// Global Cmd+E shortcut
	useEffect(() => {
		function handleKeyDown(e: KeyboardEvent) {
			if ((e.metaKey || e.ctrlKey) && e.key === "e" && isSessionActive) {
				e.preventDefault();
				toggleEditMode();
			}
		}
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [toggleEditMode, isSessionActive]);

	if (!mergedDiff) {
		return (
			<div className="flex items-center justify-center h-full text-zinc-500 text-sm">
				Select commits to see diffs
			</div>
		);
	}

	if (selectedFilePaths.size === 0) {
		return (
			<div className="flex items-center justify-center h-full text-zinc-500 text-sm">
				Select files to view their diffs
			</div>
		);
	}

	if (isDiffLoading && fileDiffContents.size === 0) {
		return (
			<div className="flex items-center justify-center h-full text-zinc-400 text-sm">
				Loading diffs...
			</div>
		);
	}

	const orderedPaths = mergedDiff.files
		.map((f) => f.path)
		.filter((p) => selectedFilePaths.has(p));

	return (
		<div className="h-full overflow-y-auto">
			{editMode && (
				<div className="px-4 py-1.5 bg-amber-900/30 border-b border-amber-800/50 text-xs text-amber-300 flex items-center gap-2">
					<span className="font-bold">EDIT MODE</span>
					<span className="text-amber-400/70">
						The new side is editable. Changes are saved to disk when you exit edit mode.
					</span>
					<div className="flex-1" />
					<span className="text-amber-500">{"\u2318"}E to exit</span>
				</div>
			)}
			{orderedPaths.map((path) => {
				const content = fileDiffContents.get(path);
				if (!content) return null;
				return <FileDiffSection key={path} content={content} editMode={editMode} />;
			})}
		</div>
	);
}

interface FileDiffSectionProps {
	content: FileDiffContent;
	editMode: boolean;
}

function FileDiffSection({ content, editMode }: FileDiffSectionProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const viewRef = useRef<MergeView | null>(null);
	const readOnlyCompartment = useRef(new Compartment());
	const originalNewContent = useRef(content.new_content);
	const [collapsed, setCollapsed] = useState(false);
	const isSessionActive = useReviewStore((s) => s.isSessionActive);
	const startComment = useReviewStore((s) => s.startComment);
	const addComment = useReviewStore((s) => s.addComment);
	const [edited, setEdited] = useState(false);

	// Toggle readOnly when editMode changes
	useEffect(() => {
		if (!viewRef.current) return;
		viewRef.current.b.dispatch({
			effects: readOnlyCompartment.current.reconfigure(
				EditorState.readOnly.of(!editMode),
			),
		});

		// When exiting edit mode, save changes if any were made
		if (!editMode && viewRef.current && edited) {
			const newContent = viewRef.current.b.state.doc.toString();
			if (newContent !== originalNewContent.current) {
				applyEdit(content.path, originalNewContent.current, newContent);
				originalNewContent.current = newContent;
			}
			setEdited(false);
		}
	}, [editMode]);

	async function applyEdit(filePath: string, oldContent: string, newContent: string) {
		try {
			await writeFileToWorkdir(filePath, newContent);

			// Auto-generate an auto_edit comment
			if (isSessionActive) {
				const lines = newContent.split("\n");
				const oldLines = oldContent.split("\n");
				let firstDiffLine = 0;
				for (let i = 0; i < Math.min(lines.length, oldLines.length); i++) {
					if (lines[i] !== oldLines[i]) {
						firstDiffLine = i + 1;
						break;
					}
				}

				await addComment({
					file: filePath,
					side: "new",
					start_line: firstDiffLine || 1,
					end_line: firstDiffLine || 1,
					body: "Manual edit applied to working tree",
					comment_type: "auto_edit",
					severity: "info",
					context_before: "",
					context_content: "",
					context_after: "",
				});
			}
		} catch (e) {
			console.error("Failed to apply edit:", e);
		}
	}

	useEffect(() => {
		if (!containerRef.current || collapsed) return;

		if (viewRef.current) {
			viewRef.current.destroy();
			viewRef.current = null;
		}

		const langExt = getLanguageExtension(content.path);

		const baseExtensions = [
			oneDark,
			lineNumbers(),
			EditorView.lineWrapping,
			...(langExt ? [langExt] : []),
		];

		const extensionsA = [
			...baseExtensions,
			EditorState.readOnly.of(true),
			...(isSessionActive
				? commentGutter((line) => startComment(content.path, line, "old"))
				: []),
		];

		const extensionsB = [
			...baseExtensions,
			readOnlyCompartment.current.of(EditorState.readOnly.of(!editMode)),
			EditorView.updateListener.of((update) => {
				if (update.docChanged) {
					setEdited(true);
				}
			}),
			...(isSessionActive
				? commentGutter((line) => startComment(content.path, line, "new"))
				: []),
		];

		originalNewContent.current = content.new_content;

		const view = new MergeView({
			a: {
				doc: content.old_content,
				extensions: extensionsA,
			},
			b: {
				doc: content.new_content,
				extensions: extensionsB,
			},
			parent: containerRef.current,
			collapseUnchanged: { margin: 3, minSize: 4 },
			gutter: true,
			highlightChanges: false,
		});

		viewRef.current = view;

		return () => {
			view.destroy();
			viewRef.current = null;
		};
	}, [content, collapsed, isSessionActive]);

	useEffect(() => {
		if (collapsed && viewRef.current) {
			viewRef.current.destroy();
			viewRef.current = null;
		}
	}, [collapsed]);

	const fileName = content.path.split("/").pop() ?? content.path;
	const dirPath = content.path.includes("/")
		? content.path.substring(0, content.path.lastIndexOf("/") + 1)
		: "";

	return (
		<div className="border-b border-zinc-700">
			<div
				className="flex items-center px-4 py-1.5 bg-zinc-800 border-b border-zinc-700 text-sm sticky top-0 z-10 cursor-pointer hover:bg-zinc-750"
				onClick={() => setCollapsed(!collapsed)}
			>
				<span className="text-zinc-500 mr-2 text-xs w-4">
					{collapsed ? "\u25B6" : "\u25BC"}
				</span>
				<span className="text-zinc-500 font-mono text-xs">{dirPath}</span>
				<span className="text-zinc-300 font-mono text-xs">{fileName}</span>
				<span className="ml-2 text-[11px] text-zinc-500">
					({content.status})
				</span>
				{edited && (
					<span className="ml-2 text-[11px] text-amber-400">modified</span>
				)}
			</div>
			{!collapsed && <div ref={containerRef} />}
		</div>
	);
}
