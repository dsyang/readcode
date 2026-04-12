/**
 * CodeMirror gutter for adding comments.
 * Shows "+" on hover for uncommmented lines, and a speech bubble on commented lines.
 * Captures selection range for multi-line comments.
 */
import { Facet } from "@codemirror/state";
import { EditorView, gutter, GutterMarker } from "@codemirror/view";

class AddMarker extends GutterMarker {
	toDOM(): Text {
		return document.createTextNode("+");
	}
}

class CommentedMarker extends GutterMarker {
	toDOM(): HTMLElement {
		const span = document.createElement("span");
		span.textContent = "\uD83D\uDCAC";
		span.style.fontSize = "10px";
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
 * onClick receives (startLine, endLine) — if the user has a selection spanning
 * multiple lines, both will differ; otherwise they'll be the same.
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

					// Check if there's a multi-line selection
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
				color: "transparent",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				fontSize: "14px",
				fontWeight: "bold",
				padding: "0",
			},
			".rc-comment-gutter .cm-gutterElement:hover": {
				color: "#60a5fa",
			},
		}),
	];
}
