/**
 * CodeMirror extension that fires a callback when a user clicks a line number gutter.
 */
import { EditorView, gutter, GutterMarker } from "@codemirror/view";

class CommentGutterMarker extends GutterMarker {
	toDOM(): Text {
		return document.createTextNode("+");
	}
}

const marker = new CommentGutterMarker();

/**
 * Creates a gutter that shows a "+" on hover and fires `onClick(lineNumber)`
 * when clicked.
 */
export function commentGutter(onClick: (line: number) => void) {
	return [
		gutter({
			class: "rc-comment-gutter",
			lineMarker: () => marker,
			domEventHandlers: {
				mousedown(view, line) {
					const lineNo = view.state.doc.lineAt(line.from).number;
					onClick(lineNo);
					return true;
				},
			},
		}),
		EditorView.baseTheme({
			".rc-comment-gutter": {
				width: "16px",
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
