import { describe, expect, it } from "vitest"

import {
	DEFAULT_MAX_BYTES,
	MAX_BYTES_LIMIT,
	parseWindow,
	renderMarker,
	type MarkerInput,
	type WindowSpec,
} from "./window.ts"

function parsed(spec: WindowSpec, extra: { maxBytes?: number; clamped?: boolean } = {}) {
	return {
		ok: true as const,
		spec,
		maxBytes: extra.maxBytes ?? DEFAULT_MAX_BYTES,
		clamped: extra.clamped ?? false,
	}
}

describe("parseWindow", () => {
	it("returns none when no window parameter is set", () => {
		expect(parseWindow({ command: "ls" })).toEqual({ ok: false, none: true })
		expect(parseWindow({ tail: 0, head: 0, max_bytes: 1024 })).toEqual({ ok: false, none: true })
		expect(parseWindow(undefined)).toEqual({ ok: false, none: true })
	})

	it("reads tail, head and both", () => {
		expect(parseWindow({ tail: 3 })).toEqual(parsed({ kind: "tail", tail: 3 }))
		expect(parseWindow({ head: 3 })).toEqual(parsed({ kind: "head", head: 3 }))
		expect(parseWindow({ head: 2, tail: 2 })).toEqual(parsed({ kind: "headtail", head: 2, tail: 2 }))
	})

	it("reads closed and open line ranges", () => {
		expect(parseWindow({ lines: { start: 50000, end: 50002 } })).toEqual(
			parsed({ kind: "range", start: 50000, end: 50002 }),
		)
		expect(parseWindow({ lines: { start: 99999 } })).toEqual(parsed({ kind: "range", start: 99999 }))
	})

	it("defaults max_bytes and clamps values above the limit", () => {
		expect(parseWindow({ tail: 1 })).toEqual(parsed({ kind: "tail", tail: 1 }))
		expect(parseWindow({ tail: 1, max_bytes: 1000 })).toEqual(
			parsed({ kind: "tail", tail: 1 }, { maxBytes: 1000 }),
		)
		expect(parseWindow({ tail: 1, max_bytes: 9_000_000 })).toEqual(
			parsed({ kind: "tail", tail: 1 }, { maxBytes: MAX_BYTES_LIMIT, clamped: true }),
		)
	})

	it("rejects incompatible combinations", () => {
		expect(parseWindow({ lines: { start: 1 }, tail: 2 })).toEqual({
			ok: false,
			reason: "lines cannot be combined with head or tail",
		})
		expect(parseWindow({ lines: { start: 1 }, head: 2 })).toEqual({
			ok: false,
			reason: "lines cannot be combined with head or tail",
		})
		expect(parseWindow({ lines: { start: 5, end: 1 } })).toEqual({
			ok: false,
			reason: "lines.end must be greater than or equal to lines.start",
		})
		expect(parseWindow({ lines: {} })).toEqual({
			ok: false,
			reason: "lines.start must be an integer greater than or equal to 1",
		})
		expect(parseWindow({ tail: -1 })).toEqual({
			ok: false,
			reason: "tail must be an integer greater than or equal to 0",
		})
	})
})

function marker(input: Partial<MarkerInput> & Pick<MarkerInput, "spec" | "ranges">): string {
	return renderMarker({
		total: 120_000,
		totalKnown: true,
		capped: false,
		stoppedEarly: false,
		clamped: false,
		maxBytes: DEFAULT_MAX_BYTES,
		savedPath: "/tmp/out",
		...input,
	})
}

describe("renderMarker", () => {
	it("renders the saved path for each mode", () => {
		expect(marker({ spec: { kind: "tail", tail: 5 }, ranges: [{ start: 998, end: 1002 }] })).toBe(
			"[showing lines 998-1002 of 120000 (tail 5); full output saved to /tmp/out]",
		)
		expect(marker({ spec: { kind: "head", head: 5 }, ranges: [{ start: 1, end: 5 }] })).toBe(
			"[showing lines 1-5 of 120000 (head 5); full output saved to /tmp/out]",
		)
		expect(
			marker({
				spec: { kind: "headtail", head: 5, tail: 5 },
				ranges: [
					{ start: 1, end: 5 },
					{ start: 119_996, end: 120_000 },
				],
			}),
		).toBe(
			"[showing lines 1-5 and 119996-120000 of 120000 (head 5, tail 5); full output saved to /tmp/out]",
		)
		expect(
			marker({ spec: { kind: "range", start: 200, end: 400 }, ranges: [{ start: 200, end: 400 }] }),
		).toBe("[showing lines 200-400 of 120000 (lines 200-400); full output saved to /tmp/out]")
	})

	it("does not invent a path when the output was not truncated", () => {
		expect(
			marker({
				spec: { kind: "head", head: 2 },
				ranges: [{ start: 1, end: 2 }],
				total: 3,
				savedPath: undefined,
			}),
		).toBe("[showing lines 1-2 of 3 (head 2); full output was not saved because the result was not truncated]")
	})

	it("appends limits and scan notes", () => {
		expect(
			marker({
				spec: { kind: "head", head: 100 },
				ranges: [{ start: 1, end: 2 }],
				total: 100,
				capped: true,
				maxBytes: 100,
			}),
		).toBe(
			"[showing lines 1-2 of 100 (head 100); capped at 100 bytes; full output saved to /tmp/out]",
		)
		expect(
			marker({
				spec: { kind: "tail", tail: 2 },
				ranges: [{ start: 1, end: 2 }],
				total: 2,
				totalKnown: false,
				stoppedEarly: true,
			}),
		).toBe(
			"[showing lines 1-2 of at least 2 (tail 2); scan stopped after 5000 ms; full output saved to /tmp/out]",
		)
		expect(
			marker({
				spec: { kind: "head", head: 1 },
				ranges: [{ start: 1, end: 1 }],
				total: 1,
				clamped: true,
			}),
		).toBe(
			"[showing lines 1-1 of 1 (head 1); max_bytes clamped to 5242880; full output saved to /tmp/out]",
		)
	})

	it("describes empty output and empty ranges", () => {
		expect(marker({ spec: { kind: "tail", tail: 3 }, ranges: [], total: 0 })).toBe(
			"[showing 0 lines of 0 (tail 3); full output saved to /tmp/out]",
		)
		expect(
			marker({ spec: { kind: "range", start: 200, end: 400 }, ranges: [], total: 100 }),
		).toBe("[no lines in the requested range; total 100 (lines 200-400); full output saved to /tmp/out]")
	})
})
