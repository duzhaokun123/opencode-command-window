import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { applyWindow, isTruncatedPreview, parseTotalHint, type AfterEventLike, type ResultLike } from "./apply.ts"

let directory: string

beforeAll(async () => {
	directory = await mkdtemp(join(tmpdir(), "command-window-apply-"))
})

afterAll(async () => {
	await rm(directory, { recursive: true, force: true })
})

function shellEvent(input: unknown, options: {
	output?: unknown
	content?: ResultLike["content"]
	metadata?: Record<string, unknown>
} = {}): AfterEventLike {
	return {
		tool: "shell",
		status: "completed",
		input: { command: "x", ...(typeof input === "object" && input !== null ? input : {}) },
		result: {
			output: options.output ?? { output: "1\n2\n3", exitCode: 0, wallTimeSeconds: 0.1 },
			content: options.content ?? [
				{ type: "text", text: "1\n2\n3" },
				{ type: "text", text: "Exit code: 1" },
			],
			metadata: options.metadata ?? { status: "completed", truncated: false },
		},
	}
}

describe("marker helpers", () => {
	it("parses the total from both built-in markers", () => {
		expect(parseTotalHint("x\n\n[showing lines 1-10 of 120000; full output saved to /p]")).toBe(120_000)
		expect(parseTotalHint("[showing the last 1 KiB of line 42 (12 KiB); full output saved to /p]")).toBe(42)
		expect(parseTotalHint("plain output")).toBeUndefined()
	})

	it("detects truncated previews", () => {
		expect(isTruncatedPreview("[showing lines 1-10 of 120; full output saved to /p]")).toBe(true)
		expect(isTruncatedPreview("[showing the last 1 KiB of line 2 (12 KiB); full output saved to /p]")).toBe(true)
		expect(isTruncatedPreview("1\n2\n3")).toBe(false)
	})
})

describe("applyWindow", () => {
	it("leaves the result untouched without window parameters", async () => {
		const event = shellEvent({})
		const before = structuredClone(event)
		await applyWindow(event)
		expect(event).toEqual(before)
	})

	it("windows complete inline output and keeps the notice part", async () => {
		const event = shellEvent({ tail: 2 })
		await applyWindow(event)
		const text = "2\n3\n\n[showing lines 2-3 of 3 (tail 2); full output was not saved because the result was not truncated]"
		expect(event.result?.output).toMatchObject({ output: text })
		expect(event.result?.content).toEqual([
			{ type: "text", text },
			{ type: "text", text: "Exit code: 1" },
		])
		expect(event.result?.metadata).toEqual({
			status: "completed",
			truncated: true,
			window: { mode: "tail", shownLines: 2, totalLines: 3, maxBytes: 204_800, clamped: false },
		})
	})

	it("reads another range from the saved output file", async () => {
		const path = join(directory, "saved.txt")
		await writeFile(path, "1\n2\n3\n4\n")
		const preview = "1\n2\n\n[showing lines 1-2 of 4; full output saved to " + path + "]"
		const event = shellEvent(
			{ tail: 2 },
			{
				output: { output: preview, outputPath: path, exitCode: 0, wallTimeSeconds: 0.1 },
				content: [
					{ type: "text", text: preview },
					{ type: "text", text: "Exit code: 0" },
				],
				metadata: { status: "completed", truncated: true },
			},
		)
		await applyWindow(event)
		const text = `3\n4\n\n[showing lines 3-4 of 4 (tail 2); full output saved to ${path}]`
		expect(event.result?.output).toMatchObject({ output: text, outputPath: path })
		expect(event.result?.content).toEqual([
			{ type: "text", text },
			{ type: "text", text: "Exit code: 0" },
		])
	})

	it("prepends a note for an invalid combination", async () => {
		const event = shellEvent({ lines: { start: 5, end: 1 } })
		await applyWindow(event)
		expect(event.result?.content).toEqual([
			{
				type: "text",
				text: "[window error: lines.end must be greater than or equal to lines.start; returning the default preview. Valid combinations: tail, head, tail+head, lines.]",
			},
			{ type: "text", text: "1\n2\n3" },
			{ type: "text", text: "Exit code: 1" },
		])
		expect(event.result?.output).toEqual({ output: "1\n2\n3", exitCode: 0, wallTimeSeconds: 0.1 })
		expect(event.result?.metadata).toEqual({ status: "completed", truncated: false })
	})

	it("does not window a truncated preview without its file", async () => {
		const preview = "tail\n\n[showing lines 10-10 of 10; full output saved to /missing]"
		const event = shellEvent(
			{ head: 1 },
			{
				output: { output: preview, exitCode: 0, wallTimeSeconds: 0.1 },
				content: [{ type: "text", text: preview }],
			},
		)
		await applyWindow(event)
		expect(event.result?.content).toEqual([
			{
				type: "text",
				text: "[window not applied: the full output is unavailable; showing the default preview.]",
			},
			{ type: "text", text: preview },
		])
		expect(event.result?.output).toMatchObject({ output: preview })
	})

	it("does not window when the saved file is missing", async () => {
		const event = shellEvent(
			{ head: 1 },
			{ output: { output: "1\n2", outputPath: join(directory, "missing"), exitCode: 0, wallTimeSeconds: 0.1 } },
		)
		await applyWindow(event)
		expect(event.result?.content?.[0]).toEqual({
			type: "text",
			text: "[window not applied: the full output file is unavailable; showing the default preview.]",
		})
	})

	it("keeps background and killed results unchanged", async () => {
		const background = shellEvent({ tail: 1 }, { metadata: { status: "running", truncated: false } })
		const backgroundBefore = structuredClone(background)
		await applyWindow(background)
		expect(background).toEqual(backgroundBefore)

		const killed = shellEvent({ tail: 1 }, { metadata: { status: "completed", truncated: false, killed: true } })
		const killedBefore = structuredClone(killed)
		await applyWindow(killed)
		expect(killed).toEqual(killedBefore)
	})

	it("describes binary output", async () => {
		const path = join(directory, "binary.bin")
		await writeFile(path, Buffer.from([0x61, 0x00, 0x62, 0x0a]))
		const event = shellEvent(
			{ head: 1 },
			{
				output: { output: "binary", outputPath: path, exitCode: 0, wallTimeSeconds: 0.1 },
				content: [{ type: "text", text: "binary" }],
				metadata: { status: "completed", truncated: true },
			},
		)
		await applyWindow(event)
		const text = `[output is binary; 4 bytes at ${path}]`
		expect(event.result?.output).toMatchObject({ output: text })
		expect(event.result?.content).toEqual([{ type: "text", text }])
		expect(event.result?.metadata).toMatchObject({ truncated: false, window: { mode: "binary", totalBytes: 4 } })
	})

	it("notes a clamped max_bytes", async () => {
		const event = shellEvent({ tail: 1, max_bytes: 9_000_000 })
		await applyWindow(event)
		expect(event.result?.output).toMatchObject({
			output:
				"3\n\n[showing lines 3-3 of 3 (tail 1); max_bytes clamped to 5242880; full output was not saved because the result was not truncated]",
		})
	})

	it("reports empty output", async () => {
		const event = shellEvent({ tail: 2 }, { output: { output: "(no output)", exitCode: 0, wallTimeSeconds: 0.1 }, content: [] })
		await applyWindow(event)
		expect(event.result?.output).toMatchObject({
			output:
				"(no output)\n\n[showing 0 lines of 0 (tail 2); full output was not saved because the result was not truncated]",
		})
	})

	it("reports a range past the end without claiming there was no output", async () => {
		const event = shellEvent({ lines: { start: 10 } })
		await applyWindow(event)
		expect(event.result?.output).toMatchObject({
			output:
				"[no lines in the requested range; total 3 (lines 10-); full output was not saved because the result was not truncated]",
		})
	})

	it("ignores other tools and failed calls", async () => {
		const other: AfterEventLike = { tool: "read", status: "completed", input: { tail: 1 }, result: { output: { output: "x" } } }
		const otherBefore = structuredClone(other)
		await applyWindow(other)
		expect(other).toEqual(otherBefore)

		const failed: AfterEventLike = { tool: "shell", status: "error", input: { tail: 1 } }
		const failedBefore = structuredClone(failed)
		await applyWindow(failed)
		expect(failed).toEqual(failedBefore)
	})
})
