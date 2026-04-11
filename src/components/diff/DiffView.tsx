import { useEffect, useRef } from "react";
import { MergeView } from "@codemirror/merge";
import { EditorView, lineNumbers } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { useSelectionStore } from "../../stores/selectionStore";
import { getLanguageExtension } from "./languages";

export function DiffView() {
	const fileDiffContent = useSelectionStore((s) => s.fileDiffContent);
	const selectedFilePath = useSelectionStore((s) => s.selectedFilePath);
	const isDiffLoading = useSelectionStore((s) => s.isDiffLoading);
	const containerRef = useRef<HTMLDivElement>(null);
	const viewRef = useRef<MergeView | null>(null);

	useEffect(() => {
		if (!containerRef.current || !fileDiffContent) return;

		// Clean up previous view
		if (viewRef.current) {
			viewRef.current.destroy();
			viewRef.current = null;
		}

		const langExt = getLanguageExtension(fileDiffContent.path);
		const extensions = [
			oneDark,
			lineNumbers(),
			EditorView.lineWrapping,
			EditorState.readOnly.of(true),
			...(langExt ? [langExt] : []),
		];

		const view = new MergeView({
			a: {
				doc: fileDiffContent.old_content,
				extensions,
			},
			b: {
				doc: fileDiffContent.new_content,
				extensions,
			},
			parent: containerRef.current,
			collapseUnchanged: { margin: 3, minSize: 4 },
			gutter: true,
		});

		viewRef.current = view;

		return () => {
			view.destroy();
			viewRef.current = null;
		};
	}, [fileDiffContent]);

	if (!selectedFilePath) {
		return (
			<div className="flex items-center justify-center h-full text-zinc-500 text-sm">
				Select a file to view its diff
			</div>
		);
	}

	if (isDiffLoading) {
		return (
			<div className="flex items-center justify-center h-full text-zinc-400 text-sm">
				Loading diff...
			</div>
		);
	}

	return (
		<div className="h-full flex flex-col">
			<div className="flex items-center px-4 py-1.5 bg-zinc-800 border-b border-zinc-700 text-sm">
				<span className="text-zinc-300 font-mono">{selectedFilePath}</span>
				{fileDiffContent && (
					<span className="ml-2 text-xs text-zinc-500">
						({fileDiffContent.status})
					</span>
				)}
			</div>
			<div ref={containerRef} className="flex-1 overflow-auto" />
		</div>
	);
}
