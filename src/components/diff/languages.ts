import type { Extension } from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { markdown } from "@codemirror/lang-markdown";

const extensionMap: Record<string, () => Extension> = {
	".js": () => javascript(),
	".jsx": () => javascript({ jsx: true }),
	".ts": () => javascript({ typescript: true }),
	".tsx": () => javascript({ jsx: true, typescript: true }),
	".json": () => json(),
	".py": () => python(),
	".rs": () => rust(),
	".css": () => css(),
	".html": () => html(),
	".htm": () => html(),
	".md": () => markdown(),
	".markdown": () => markdown(),
};

export function getLanguageExtension(filePath: string): Extension | null {
	const lastDot = filePath.lastIndexOf(".");
	if (lastDot === -1) return null;
	const ext = filePath.substring(lastDot).toLowerCase();
	const factory = extensionMap[ext];
	return factory ? factory() : null;
}
