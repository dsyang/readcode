import { useEffect, useRef, useMemo } from "react";
import { useBugReportStore } from "../../stores/bugReportStore";

const DOT_SIZE = 18;
const POPOVER_WIDTH = 320;
const POPOVER_HEIGHT = 180;
const POPOVER_GAP = 16;

function clampPopoverPosition(
	dot: { x: number; y: number },
	viewport: { w: number; h: number },
): { left: number; top: number } {
	let left = dot.x + POPOVER_GAP;
	let top = dot.y + POPOVER_GAP;
	if (left + POPOVER_WIDTH > viewport.w) left = dot.x - POPOVER_GAP - POPOVER_WIDTH;
	if (top + POPOVER_HEIGHT > viewport.h) top = dot.y - POPOVER_GAP - POPOVER_HEIGHT;
	return { left: Math.max(8, left), top: Math.max(8, top) };
}

export function BugReportOverlay() {
	const mode = useBugReportStore((s) => s.mode);
	const dot = useBugReportStore((s) => s.dot);
	const description = useBugReportStore((s) => s.description);
	const error = useBugReportStore((s) => s.error);
	const placeDot = useBugReportStore((s) => s.placeDot);
	const setDescription = useBugReportStore((s) => s.setDescription);
	const submit = useBugReportStore((s) => s.submit);
	const cancel = useBugReportStore((s) => s.cancel);

	const textareaRef = useRef<HTMLTextAreaElement | null>(null);

	useEffect(() => {
		if (mode === "idle") return;
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				cancel();
			}
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [mode, cancel]);

	useEffect(() => {
		if (mode === "editing") textareaRef.current?.focus();
	}, [mode]);

	const popoverPos = useMemo(() => {
		if (!dot) return null;
		return clampPopoverPosition(dot, { w: window.innerWidth, h: window.innerHeight });
	}, [dot]);

	if (mode === "idle") return null;

	const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
		if (mode !== "placing") return;
		placeDot(e.clientX, e.clientY);
	};

	return (
		<div
			className="fixed inset-0 z-50"
			style={{ cursor: mode === "placing" ? "crosshair" : "default" }}
			onClick={handleOverlayClick}
			data-testid="bug-report-overlay"
		>
			{mode === "placing" && (
				<div className="absolute top-4 left-1/2 -translate-x-1/2 bg-zinc-900/90 border border-zinc-700 text-zinc-200 text-xs px-3 py-1.5 rounded-md shadow-lg pointer-events-none">
					Click anywhere to mark the issue. Esc to cancel.
				</div>
			)}

			{dot && (
				<div
					aria-hidden
					className="absolute rounded-full bg-red-500 border-2 border-white pointer-events-none"
					style={{
						width: DOT_SIZE,
						height: DOT_SIZE,
						left: dot.x - DOT_SIZE / 2,
						top: dot.y - DOT_SIZE / 2,
						boxShadow: "0 0 0 1px rgba(0,0,0,0.6), 0 2px 6px rgba(0,0,0,0.5)",
					}}
				/>
			)}

			{mode === "editing" && popoverPos && (
				<div
					className="absolute bg-zinc-800 border border-zinc-700 rounded-lg shadow-2xl"
					style={{
						left: popoverPos.left,
						top: popoverPos.top,
						width: POPOVER_WIDTH,
					}}
					onClick={(e) => e.stopPropagation()}
				>
					<div className="px-3 py-2 border-b border-zinc-700 text-xs font-semibold text-white">
						Describe the bug
					</div>
					<div className="p-3 space-y-2">
						<textarea
							ref={textareaRef}
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							placeholder="What's wrong here?"
							className="w-full h-24 bg-zinc-900 border border-zinc-700 rounded p-2 text-sm text-zinc-100 resize-none focus:outline-none focus:border-zinc-500"
						/>
						<div className="text-[11px] text-zinc-500">
							A screenshot and today's logs will be saved locally.
						</div>
						{error && (
							<div className="text-xs text-red-300 bg-red-900/30 border border-red-800 rounded p-2">
								{error}
							</div>
						)}
						<div className="flex justify-end gap-2 pt-1">
							<button
								onClick={cancel}
								className="text-xs px-2.5 py-1 rounded text-zinc-300 hover:text-white"
							>
								Cancel
							</button>
							<button
								onClick={submit}
								disabled={!description.trim()}
								className="text-xs px-3 py-1 rounded bg-red-600 hover:bg-red-500 text-white disabled:bg-zinc-700 disabled:text-zinc-500"
							>
								Submit
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
