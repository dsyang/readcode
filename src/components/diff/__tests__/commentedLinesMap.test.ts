import { describe, it, expect } from "vitest";
import { buildCommentedLinesMap } from "../commentedLinesMap";
import type { ReviewSession } from "../../../api/reviewTypes";

function fakeSession(comments: ReviewSession["comments"]): ReviewSession {
	const now = new Date().toISOString();
	return {
		version: "1.0",
		session: {
			id: "test",
			repo: "/r",
			review_location: "local",
			branch: "main",
			base_commit: null,
			head_commit: "h",
			reviewed_commits: [],
			created_at: now,
			updated_at: now,
		},
		comments,
		edits: [],
		summary: null,
	};
}

describe("buildCommentedLinesMap", () => {
	it("returns empty map when session is null", () => {
		expect(buildCommentedLinesMap(null).size).toBe(0);
	});

	it("returns empty map when session has no comments", () => {
		expect(buildCommentedLinesMap(fakeSession([])).size).toBe(0);
	});

	it("groups single-line comments by file and side", () => {
		const session = fakeSession([
			{
				id: "c1",
				type: "comment",
				file: "src/a.ts",
				line_range: { side: "new", start: 5, end: 5 },
				body: "",
				severity: "info",
				resolved: false,
				created_at: "",
				context: { before: "", content: "", after: "" },
			},
			{
				id: "c2",
				type: "issue",
				file: "src/a.ts",
				line_range: { side: "old", start: 10, end: 10 },
				body: "",
				severity: "warning",
				resolved: false,
				created_at: "",
				context: { before: "", content: "", after: "" },
			},
		]);
		const map = buildCommentedLinesMap(session);
		expect(map.get("src/a.ts")?.new.has(5)).toBe(true);
		expect(map.get("src/a.ts")?.old.has(10)).toBe(true);
	});

	it("expands multi-line ranges inclusively", () => {
		const session = fakeSession([
			{
				id: "c1",
				type: "comment",
				file: "x.ts",
				line_range: { side: "new", start: 3, end: 7 },
				body: "",
				severity: "info",
				resolved: false,
				created_at: "",
				context: { before: "", content: "", after: "" },
			},
		]);
		const lines = buildCommentedLinesMap(session).get("x.ts")?.new;
		expect(lines?.size).toBe(5);
		for (let i = 3; i <= 7; i++) expect(lines?.has(i)).toBe(true);
	});

	it("merges overlapping ranges into one set per side", () => {
		const session = fakeSession([
			{
				id: "c1",
				type: "comment",
				file: "x.ts",
				line_range: { side: "new", start: 1, end: 3 },
				body: "",
				severity: "info",
				resolved: false,
				created_at: "",
				context: { before: "", content: "", after: "" },
			},
			{
				id: "c2",
				type: "comment",
				file: "x.ts",
				line_range: { side: "new", start: 2, end: 5 },
				body: "",
				severity: "info",
				resolved: false,
				created_at: "",
				context: { before: "", content: "", after: "" },
			},
		]);
		const lines = buildCommentedLinesMap(session).get("x.ts")?.new;
		expect(lines?.size).toBe(5); // 1..5 unique
	});

	it("keeps separate entries per file", () => {
		const session = fakeSession([
			{
				id: "c1",
				type: "comment",
				file: "a.ts",
				line_range: { side: "new", start: 1, end: 1 },
				body: "",
				severity: "info",
				resolved: false,
				created_at: "",
				context: { before: "", content: "", after: "" },
			},
			{
				id: "c2",
				type: "comment",
				file: "b.ts",
				line_range: { side: "new", start: 2, end: 2 },
				body: "",
				severity: "info",
				resolved: false,
				created_at: "",
				context: { before: "", content: "", after: "" },
			},
		]);
		const map = buildCommentedLinesMap(session);
		expect(map.size).toBe(2);
		expect(map.get("a.ts")?.new.has(1)).toBe(true);
		expect(map.get("b.ts")?.new.has(2)).toBe(true);
	});
});
