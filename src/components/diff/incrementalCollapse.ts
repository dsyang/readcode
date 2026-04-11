/**
 * Custom incremental collapse for CodeMirror 6 MergeView.
 *
 * Replaces the built-in `collapseUnchanged` with one that supports
 * expanding N lines at a time from either direction.
 */
import { Compartment, RangeSetBuilder } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { getChunks, type MergeView } from "@codemirror/merge";

const CONTEXT_LINES = 3;
const MIN_COLLAPSE = 6;
const EXPAND_STEP = 15;

export interface CollapseRegion {
	/** 1-based line range in side A */
	fromA: number;
	toA: number;
	/** 1-based line range in side B */
	fromB: number;
	toB: number;
	/** Lines revealed from the top */
	expandedTop: number;
	/** Lines revealed from the bottom */
	expandedBottom: number;
}

export interface CollapseController {
	regions: CollapseRegion[];
	expandUp: (index: number) => void;
	expandDown: (index: number) => void;
	expandAll: (index: number) => void;
}

/**
 * Compute initial unchanged regions from MergeView chunks.
 * Chunks represent changed regions; gaps between them are unchanged.
 */
function computeRegions(mv: MergeView): CollapseRegion[] {
	const chunkData = getChunks(mv.b.state);
	if (!chunkData) return [];
	const chunks = chunkData.chunks;
	if (chunks.length === 0) return [];

	const docA = mv.a.state.doc;
	const docB = mv.b.state.doc;
	const regions: CollapseRegion[] = [];

	let prevEndA = 1;
	let prevEndB = 1;

	for (const chunk of chunks) {
		const chunkFromA = docA.lineAt(chunk.fromA).number;
		const chunkFromB = docB.lineAt(chunk.fromB).number;

		// Unchanged gap before this chunk
		const gapFromA = prevEndA;
		const gapToA = chunkFromA - 1;
		const gapFromB = prevEndB;
		const gapToB = chunkFromB - 1;

		// Apply context margin
		const collapsedFromA = gapFromA + CONTEXT_LINES;
		const collapsedToA = gapToA - CONTEXT_LINES;
		const collapsedFromB = gapFromB + CONTEXT_LINES;
		const collapsedToB = gapToB - CONTEXT_LINES;

		if (collapsedToA - collapsedFromA + 1 >= MIN_COLLAPSE) {
			regions.push({
				fromA: collapsedFromA,
				toA: collapsedToA,
				fromB: collapsedFromB,
				toB: collapsedToB,
				expandedTop: 0,
				expandedBottom: 0,
			});
		}

		const chunkToA = chunk.toA < docA.length ? docA.lineAt(chunk.toA).number : docA.lines;
		const chunkToB = chunk.toB < docB.length ? docB.lineAt(chunk.toB).number : docB.lines;
		prevEndA = chunkToA + 1;
		prevEndB = chunkToB + 1;
	}

	// Trailing unchanged region after the last chunk
	const trailingFromA = prevEndA + CONTEXT_LINES;
	const trailingToA = docA.lines - CONTEXT_LINES;
	const trailingFromB = prevEndB + CONTEXT_LINES;
	const trailingToB = docB.lines - CONTEXT_LINES;

	if (trailingToA - trailingFromA + 1 >= MIN_COLLAPSE) {
		regions.push({
			fromA: trailingFromA,
			toA: trailingToA,
			fromB: trailingFromB,
			toB: trailingToB,
			expandedTop: 0,
			expandedBottom: 0,
		});
	}

	// Leading unchanged region (before the first chunk)
	// Already handled by the loop since prevEndA starts at 1

	return regions;
}

class CollapseWidget extends WidgetType {
	constructor(
		private hiddenLines: number,
		private regionIndex: number,
		private canExpandUp: boolean,
		private canExpandDown: boolean,
		private controller: CollapseController,
	) {
		super();
	}

	toDOM(): HTMLElement {
		const wrapper = document.createElement("div");
		wrapper.className = "rc-collapse-widget";

		if (this.canExpandUp) {
			const btn = document.createElement("button");
			btn.className = "rc-collapse-btn";
			btn.textContent = `\u25B2 ${EXPAND_STEP} lines`;
			btn.addEventListener("mousedown", (e) => {
				e.preventDefault();
				e.stopPropagation();
				this.controller.expandUp(this.regionIndex);
			});
			wrapper.appendChild(btn);
		}

		const label = document.createElement("span");
		label.className = "rc-collapse-label";
		label.textContent = `${this.hiddenLines} unchanged lines`;
		label.addEventListener("mousedown", (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.controller.expandAll(this.regionIndex);
		});
		wrapper.appendChild(label);

		if (this.canExpandDown) {
			const btn = document.createElement("button");
			btn.className = "rc-collapse-btn";
			btn.textContent = `\u25BC ${EXPAND_STEP} lines`;
			btn.addEventListener("mousedown", (e) => {
				e.preventDefault();
				e.stopPropagation();
				this.controller.expandDown(this.regionIndex);
			});
			wrapper.appendChild(btn);
		}

		return wrapper;
	}

	eq(other: CollapseWidget): boolean {
		return (
			this.hiddenLines === other.hiddenLines &&
			this.regionIndex === other.regionIndex &&
			this.canExpandUp === other.canExpandUp &&
			this.canExpandDown === other.canExpandDown
		);
	}

	get estimatedHeight(): number {
		return 28;
	}
}

function buildDecorations(
	regions: CollapseRegion[],
	side: "a" | "b",
	doc: { line(n: number): { from: number; to: number }; lines: number },
	controller: CollapseController,
) {
	const builder = new RangeSetBuilder<Decoration>();

	for (let i = 0; i < regions.length; i++) {
		const r = regions[i];
		const origFrom = side === "a" ? r.fromA : r.fromB;
		const origTo = side === "a" ? r.toA : r.toB;

		const visibleFromLine = origFrom + r.expandedTop;
		const visibleToLine = origTo - r.expandedBottom;
		const hiddenLines = visibleToLine - visibleFromLine + 1;

		if (hiddenLines < MIN_COLLAPSE) continue;
		if (visibleFromLine > doc.lines || visibleToLine < 1) continue;
		if (visibleFromLine >= visibleToLine) continue;

		const canExpandUp = r.expandedTop < (origTo - origFrom + 1 - MIN_COLLAPSE);
		const canExpandDown = r.expandedBottom < (origTo - origFrom + 1 - MIN_COLLAPSE);

		const from = doc.line(Math.max(1, visibleFromLine)).from;
		const to = doc.line(Math.min(doc.lines, visibleToLine)).to;

		if (from >= to) continue;

		builder.add(
			from,
			to,
			Decoration.replace({
				widget: new CollapseWidget(hiddenLines, i, canExpandUp, canExpandDown, controller),
				block: true,
			}),
		);
	}

	return builder.finish();
}

/**
 * Set up incremental collapse on a MergeView.
 * Returns a controller to manage expansion, and compartments for cleanup.
 */
export function setupIncrementalCollapse(mv: MergeView): CollapseController | null {
	const regions = computeRegions(mv);
	if (regions.length === 0) return null;

	const compartmentA = new Compartment();
	const compartmentB = new Compartment();

	const controller: CollapseController = {
		regions,
		expandUp(index: number) {
			const r = regions[index];
			const maxExpand = (r.toA - r.fromA + 1) - MIN_COLLAPSE;
			r.expandedTop = Math.min(r.expandedTop + EXPAND_STEP, maxExpand - r.expandedBottom);
			applyDecorations();
		},
		expandDown(index: number) {
			const r = regions[index];
			const maxExpand = (r.toA - r.fromA + 1) - MIN_COLLAPSE;
			r.expandedBottom = Math.min(r.expandedBottom + EXPAND_STEP, maxExpand - r.expandedTop);
			applyDecorations();
		},
		expandAll(index: number) {
			const r = regions[index];
			const total = r.toA - r.fromA + 1;
			r.expandedTop = total;
			r.expandedBottom = 0;
			applyDecorations();
		},
	};

	function applyDecorations() {
		const decosA = buildDecorations(regions, "a", mv.a.state.doc, controller);
		const decosB = buildDecorations(regions, "b", mv.b.state.doc, controller);
		mv.a.dispatch({
			effects: compartmentA.reconfigure(EditorView.decorations.of(decosA)),
		});
		mv.b.dispatch({
			effects: compartmentB.reconfigure(EditorView.decorations.of(decosB)),
		});
	}

	// Install initial compartments via dispatch
	const initialDecosA = buildDecorations(regions, "a", mv.a.state.doc, controller);
	const initialDecosB = buildDecorations(regions, "b", mv.b.state.doc, controller);

	mv.a.dispatch({
		effects: compartmentA.reconfigure(EditorView.decorations.of(initialDecosA)),
	});
	mv.b.dispatch({
		effects: compartmentB.reconfigure(EditorView.decorations.of(initialDecosB)),
	});

	return controller;
}
