/**
 * CodeMirror gutter for adding comments.
 * Shows "+" on hover for uncommented lines, and a dot on commented lines.
 * Captures selection range for multi-line comments.
 */
import { Facet } from "@codemirror/state";
import { EditorView, gutter, GutterMarker } from "@codemirror/view";

class AddMarker extends GutterMarker {
	elementClass = "rc-gutter-add";
	toDOM(): Text {
		return document.createTextNode("+");
	}
}

class CommentedMarker extends GutterMarker {
	elementClass = "rc-gutter-commented";
	toDOM(): HTMLElement {
		const span = document.createElement("span");
		span.className = "rc-comment-dot";
		return span;
	}
}

const addMarker = new AddMarker();
const commentedMarker = new CommentedMarker();

/** Facet to provide the set of lines that have existing comments. */
export const commentedLinesFacet = Facet.define<Set<number>, Set<number>>({
	combine: (values) => {
		if (values.length === 0) return new Set();
		const merged = new Set<number>();
		for (const s of values) {
			for (const v of s) merged.add(v);
		}
		return merged;
	},
});

/**
 * Creates a comment gutter.
 * onClick receives (startLine, endLine).
 */
export function commentGutter(onClick: (startLine: number, endLine: number) => void) {
	return [
		gutter({
			class: "rc-comment-gutter",
			lineMarker(view, line) {
				const lineNo = view.state.doc.lineAt(line.from).number;
				const commented = view.state.facet(commentedLinesFacet);
				if (commented.has(lineNo)) {
					return commentedMarker;
				}
				return addMarker;
			},
			domEventHandlers: {
				mousedown(view, line) {
					const clickedLine = view.state.doc.lineAt(line.from).number;
					const sel = view.state.selection.main;
					if (!sel.empty) {
						const startLine = view.state.doc.lineAt(sel.from).number;
						const endLine = view.state.doc.lineAt(sel.to).number;
						if (startLine !== endLine) {
							onClick(startLine, endLine);
							return true;
						}
					}
					onClick(clickedLine, clickedLine);
					return true;
				},
			},
		}),
		EditorView.baseTheme({
			".rc-comment-gutter": {
				width: "18px",
				cursor: "pointer",
			},
			".rc-comment-gutter .cm-gutterElement": {
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				padding: "0",
			},
			/* "+" marker: hidden by default, blue on hover */
			".rc-comment-gutter .rc-gutter-add": {
				color: "transparent",
				fontSize: "14px",
				fontWeight: "bold",
			},
			".rc-comment-gutter .rc-gutter-add:hover": {
				color: "#60a5fa",
			},
			/* Commented marker: always-visible blue dot */
			".rc-comment-gutter .rc-gutter-commented": {
				color: "transparent",
			},
			".rc-comment-dot": {
				width: "6px",
				height: "6px",
				borderRadius: "50%",
				backgroundColor: "#60a5fa",
			},
			".rc-comment-gutter .rc-gutter-commented:hover .rc-comment-dot": {
				backgroundColor: "#93c5fd",
				width: "8px",
				height: "8px",
			},
		}),
	];
}
