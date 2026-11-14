import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { inspectFile, scan } from "./scan.ts"

const SEQ_LINES = 100_000

let directory: string
let seqPath: string
let nonlPath: string
let emptyPath: string
let crlfPath: string
let longPath: string
let binaryPath: string

beforeAll(async () => {
	directory = await mkdtemp(join(tmpdir(), "command-window-"))
	seqPath = join(directory, "seq.txt")
	nonlPath = join(directory, "nonl.txt")
	emptyPath = join(directory, "empty.txt")
	crlfPath = join(directory, "crlf.txt")
	longPath = join(directory, "long.txt")
	binaryPath = join(directory, "binary.bin")
	const seq = Array.from({ length: SEQ_LINES }, (_, index) => String(index + 1)).join("\n")
	await writeFile(seqPath, `${seq}\n`)
	await writeFile(nonlPath, "1\n2\n3")
	await writeFile(emptyPath, "")
	await writeFile(crlfPath, "a\r\nb\r\nc\r\n")
	await writeFile(longPath, "x".repeat(10 * 1024))
	await writeFile(binaryPath, Buffer.from([0x61, 0x00, 0x62, 0x0a]))
})

afterAll(async () => {
	await rm(directory, { recursive: true, force: true })
})

const bytes = (value: string) => Buffer.byteLength(value, "utf8")

describe("scan", () => {
	it("returns the tail lines and their range", async () => {
		const result = await scan({ kind: "file", path: seqPath }, { kind: "tail", tail: 3 }, { maxBytes: 200 * 1024 })
		expect(result.text).toBe("99998\n99999\n100000")
		expect(result.total).toBe(SEQ_LINES)
		expect(result.totalKnown).toBe(true)
		expect(result.shown).toBe(3)
		expect(result.ranges).toEqual([{ start: 99_998, end: 100_000 }])
		expect(result.capped).toBe(false)
	})

	it("returns the head lines and stops early on the marker total", async () => {
		const result = await scan(
			{ kind: "file", path: seqPath },
			{ kind: "head", head: 3 },
			{ maxBytes: 200 * 1024, hintTotal: SEQ_LINES },
		)
		expect(result.text).toBe("1\n2\n3")
		expect(result.total).toBe(SEQ_LINES)
		expect(result.totalKnown).toBe(true)
		expect(result.ranges).toEqual([{ start: 1, end: 3 }])
	})

	it("counts the whole file when no total hint exists", async () => {
		const result = await scan({ kind: "file", path: seqPath }, { kind: "head", head: 3 }, { maxBytes: 200 * 1024 })
		expect(result.text).toBe("1\n2\n3")
		expect(result.total).toBe(SEQ_LINES)
	})

	it("joins head and tail with one omitted-lines line", async () => {
		const result = await scan(
			{ kind: "file", path: seqPath },
			{ kind: "headtail", head: 2, tail: 2 },
			{ maxBytes: 200 * 1024 },
		)
		expect(result.text).toBe("1\n2\n[... 99996 lines omitted ...]\n99999\n100000")
		expect(result.shown).toBe(4)
		expect(result.ranges).toEqual([
			{ start: 1, end: 2 },
			{ start: 99_999, end: 100_000 },
		])
	})

	it("returns a closed line range", async () => {
		const result = await scan(
			{ kind: "file", path: seqPath },
			{ kind: "range", start: 50_000, end: 50_002 },
			{ maxBytes: 200 * 1024, hintTotal: SEQ_LINES },
		)
		expect(result.text).toBe("50000\n50001\n50002")
		expect(result.total).toBe(SEQ_LINES)
		expect(result.ranges).toEqual([{ start: 50_000, end: 50_002 }])
	})

	it("reads an open range to the end", async () => {
		const result = await scan(
			{ kind: "file", path: seqPath },
			{ kind: "range", start: 99_999 },
			{ maxBytes: 200 * 1024, hintTotal: SEQ_LINES },
		)
		expect(result.text).toBe("99999\n100000")
		expect(result.ranges).toEqual([{ start: 99_999, end: 100_000 }])
	})

	it("stops at the byte cap", async () => {
		const result = await scan(
			{ kind: "file", path: seqPath },
			{ kind: "head", head: 100 },
			{ maxBytes: 100, hintTotal: SEQ_LINES },
		)
		expect(result.capped).toBe(true)
		expect(result.shown).toBeLessThan(100)
		expect(bytes(result.text)).toBeLessThanOrEqual(100)
		expect(result.ranges[0]).toEqual({ start: 1, end: result.shown })
	})

	it("truncates a single long line on a UTF-8 boundary", async () => {
		const result = await scan({ kind: "file", path: longPath }, { kind: "head", head: 1 }, { maxBytes: 100 })
		expect(result.capped).toBe(true)
		expect(bytes(result.text)).toBeLessThanOrEqual(100)
		expect(result.text.endsWith(" (line truncated)")).toBe(true)
		expect(result.text.startsWith("xxx")).toBe(true)
	})

	it("handles empty output", async () => {
		const result = await scan({ kind: "file", path: emptyPath }, { kind: "tail", tail: 3 }, { maxBytes: 200 * 1024 })
		expect(result).toMatchObject({ text: "", total: 0, totalKnown: true, shown: 0, ranges: [], capped: false })
	})

	it("normalizes CRLF line endings", async () => {
		const result = await scan({ kind: "file", path: crlfPath }, { kind: "head", head: 3 }, { maxBytes: 200 * 1024 })
		expect(result.text).toBe("a\nb\nc")
		expect(result.total).toBe(3)
	})

	it("keeps a file without a trailing newline at the right line count", async () => {
		const result = await scan({ kind: "file", path: nonlPath }, { kind: "head", head: 2 }, { maxBytes: 200 * 1024 })
		expect(result.text).toBe("1\n2")
		expect(result.total).toBe(3)
	})

	it("reads inline text as a complete source", async () => {
		const result = await scan({ kind: "text", text: "1\n2\n3\n" }, { kind: "tail", tail: 2 }, { maxBytes: 200 * 1024 })
		expect(result.text).toBe("2\n3")
		expect(result.total).toBe(3)
		expect(result.ranges).toEqual([{ start: 2, end: 3 }])
	})

	it("reports an empty range past the end", async () => {
		const result = await scan(
			{ kind: "file", path: nonlPath },
			{ kind: "range", start: 10, end: 20 },
			{ maxBytes: 200 * 1024 },
		)
		expect(result).toMatchObject({ text: "", total: 3, shown: 0, ranges: [] })
	})
})

describe("inspectFile", () => {
	it("detects binary output", async () => {
		await expect(inspectFile(binaryPath)).resolves.toEqual({ size: 4, binary: true })
	})

	it("measures text output", async () => {
		const info = await inspectFile(nonlPath)
		expect(info?.binary).toBe(false)
		expect(info?.size).toBe(5)
	})

	it("returns undefined for a missing file", async () => {
		await expect(inspectFile(join(directory, "missing"))).resolves.toBeUndefined()
	})
})
