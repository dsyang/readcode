import { useEffect, useRef, useState } from "react";
import { MergeView } from "@codemirror/merge";
import { EditorView, lineNumbers } from "@codemirror/view";
import { Compartment, EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { useSelectionStore } from "../../stores/selectionStore";
import { useReviewStore } from "../../stores/reviewStore";
import { getLanguageExtension } from "./languages";
import { commentGutter, commentedLinesFacet } from "./commentGutter";
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
	const scrollTarget = useReviewStore((s) => s.scrollTarget);
	const clearScrollTarget = useReviewStore((s) => s.clearScrollTarget);
	const session = useReviewStore((s) => s.session);
	const scrollContainerRef = useRef<HTMLDivElement>(null);

	// Global Cmd+E shortcut
	useEffect(() => {
		function handleKeyDown(e: KeyboardEvent) {
			if (e.metaKey && e.key === "e" && isSessionActive) {
				e.preventDefault();
				toggleEditMode();
			}
		}
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [toggleEditMode, isSessionActive]);

	// Handle scroll-to-comment (with retry for files still loading)
	useEffect(() => {
		if (!scrollTarget || !scrollContainerRef.current) return;

		let attempts = 0;
		function tryScroll() {
			if (!scrollContainerRef.current || !scrollTarget) return;
			const fileEl = scrollContainerRef.current.querySelector(
				`[data-file-path="${CSS.escape(scrollTarget.file)}"]`,
			);
			if (fileEl) {
				fileEl.scrollIntoView({ behavior: "smooth", block: "start" });
				clearScrollTarget();
			} else if (attempts < 10) {
				attempts++;
				requestAnimationFrame(tryScroll);
			} else {
				clearScrollTarget();
			}
		}
		tryScroll();
	}, [scrollTarget, clearScrollTarget, fileDiffContents]);

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

	// Build per-file commented lines from session
	const commentedLinesMap = new Map<string, { old: Set<number>; new: Set<number> }>();
	if (session) {
		for (const c of session.comments) {
			let entry = commentedLinesMap.get(c.file);
			if (!entry) {
				entry = { old: new Set(), new: new Set() };
				commentedLinesMap.set(c.file, entry);
			}
			const side = c.line_range.side === "old" ? entry.old : entry.new;
			for (let l = c.line_range.start; l <= c.line_range.end; l++) {
				side.add(l);
			}
		}
	}

	return (
		<div className="h-full overflow-y-auto" ref={scrollContainerRef}>
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
				const commented = commentedLinesMap.get(path);
				return (
					<FileDiffSection
						key={path}
						content={content}
						editMode={editMode}
						commentedLinesOld={commented?.old ?? EMPTY_SET}
						commentedLinesNew={commented?.new ?? EMPTY_SET}
					/>
				);
			})}
		</div>
	);
}

const EMPTY_SET = new Set<number>();

interface FileDiffSectionProps {
	content: FileDiffContent;
	editMode: boolean;
	commentedLinesOld: Set<number>;
	commentedLinesNew: Set<number>;
}

function FileDiffSection({ content, editMode, commentedLinesOld, commentedLinesNew }: FileDiffSectionProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const viewRef = useRef<MergeView | null>(null);
	const readOnlyCompartment = useRef(new Compartment());
	const commentedLinesCompartmentA = useRef(new Compartment());
	const commentedLinesCompartmentB = useRef(new Compartment());
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

		if (!editMode && viewRef.current && edited) {
			const newContent = viewRef.current.b.state.doc.toString();
			if (newContent !== originalNewContent.current) {
				applyEdit(content.path, originalNewContent.current, newContent);
				originalNewContent.current = newContent;
			}
			setEdited(false);
		}
		// TODO: split this effect — the readOnly toggle is correctly bound to [editMode],
		// but the auto-save block is event-shaped (fire once on true→false) and currently
		// risks writing to a stale content.path if the file switches in the same render.
		// Proper fix: extract the save into its own effect that tracks the editMode
		// transition via a usePrevious/ref, with [editMode, edited, content.path, applyEdit]
		// as deps and applyEdit wrapped in useCallback.
		// eslint-disable-next-line react-hooks/exhaustive-deps -- fire only on editMode transitions; latest applyEdit/edited/content.path are captured by the post-render closure
	}, [editMode]);

	// Update commented line markers when comments change
	useEffect(() => {
		if (!viewRef.current) return;
		viewRef.current.a.dispatch({
			effects: commentedLinesCompartmentA.current.reconfigure(
				commentedLinesFacet.of(commentedLinesOld),
			),
		});
		viewRef.current.b.dispatch({
			effects: commentedLinesCompartmentB.current.reconfigure(
				commentedLinesFacet.of(commentedLinesNew),
			),
		});
	}, [commentedLinesOld, commentedLinesNew]);

	async function applyEdit(filePath: string, oldContent: string, newContent: string) {
		try {
			await writeFileToWorkdir(filePath, newContent);
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
			commentedLinesCompartmentA.current.of(commentedLinesFacet.of(commentedLinesOld)),
			...(isSessionActive
				? commentGutter((startLine, endLine) => startComment(content.path, startLine, endLine, "old"))
				: []),
		];

		const extensionsB = [
			...baseExtensions,
			readOnlyCompartment.current.of(EditorState.readOnly.of(!editMode)),
			commentedLinesCompartmentB.current.of(commentedLinesFacet.of(commentedLinesNew)),
			EditorView.updateListener.of((update) => {
				if (update.docChanged) {
					setEdited(true);
				}
			}),
			...(isSessionActive
				? commentGutter((startLine, endLine) => startComment(content.path, startLine, endLine, "new"))
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
		// eslint-disable-next-line react-hooks/exhaustive-deps -- rebuild only on content/collapse/session changes; commentedLines and editMode are propagated via the dedicated effects above to preserve scroll/selection
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
		<div className="border-b border-zinc-700" data-file-path={content.path}>
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
