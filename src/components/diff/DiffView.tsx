import { useEffect, useRef, useState } from "react";
import { MergeView } from "@codemirror/merge";
import { EditorView, lineNumbers } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { useSelectionStore } from "../../stores/selectionStore";
import { getLanguageExtension } from "./languages";
import { setupIncrementalCollapse } from "./incrementalCollapse";
import type { FileDiffContent } from "../../api/types";

export function DiffView() {
	const selectedFilePaths = useSelectionStore((s) => s.selectedFilePaths);
	const fileDiffContents = useSelectionStore((s) => s.fileDiffContents);
	const mergedDiff = useSelectionStore((s) => s.mergedDiff);
	const isDiffLoading = useSelectionStore((s) => s.isDiffLoading);

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
			{orderedPaths.map((path) => {
				const content = fileDiffContents.get(path);
				if (!content) return null;
				return <FileDiffSection key={path} content={content} />;
			})}
		</div>
	);
}

interface FileDiffSectionProps {
	content: FileDiffContent;
}

function FileDiffSection({ content }: FileDiffSectionProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const viewRef = useRef<MergeView | null>(null);
	const [collapsed, setCollapsed] = useState(false);

	useEffect(() => {
		if (!containerRef.current || collapsed) return;

		if (viewRef.current) {
			viewRef.current.destroy();
			viewRef.current = null;
		}

		const langExt = getLanguageExtension(content.path);
		const extensions = [
			oneDark,
			lineNumbers(),
			EditorView.lineWrapping,
			EditorState.readOnly.of(true),
			...(langExt ? [langExt] : []),
		];

		const view = new MergeView({
			a: {
				doc: content.old_content,
				extensions,
			},
			b: {
				doc: content.new_content,
				extensions,
			},
			parent: containerRef.current,
			gutter: true,
			highlightChanges: false,
		});

		viewRef.current = view;

		// Set up incremental collapse after the merge view has computed chunks
		requestAnimationFrame(() => {
			if (viewRef.current) {
				setupIncrementalCollapse(viewRef.current);
			}
		});

		return () => {
			view.destroy();
			viewRef.current = null;
		};
	}, [content, collapsed]);

	// Destroy the merge view when collapsing
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
			</div>
			{!collapsed && <div ref={containerRef} />}
		</div>
	);
}
