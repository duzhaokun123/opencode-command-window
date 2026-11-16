import { describe, expect, it } from "vitest"

import { parsePipeWindow, pipesThroughHeadTail, rewritePipeWindow } from "./pipe.ts"

describe("parsePipeWindow", () => {
	it("parses the supported trailing head/tail forms", () => {
		expect(parsePipeWindow("seq 1 100 | tail -n 3")).toEqual({ ok: true, command: "seq 1 100", tail: 3 })
		expect(parsePipeWindow("seq 1 100 | tail -3")).toEqual({ ok: true, command: "seq 1 100", tail: 3 })
		expect(parsePipeWindow("seq 1 100 | tail -n3")).toEqual({ ok: true, command: "seq 1 100", tail: 3 })
		expect(parsePipeWindow("seq 1 100 | tail --lines=3")).toEqual({ ok: true, command: "seq 1 100", tail: 3 })
		expect(parsePipeWindow("seq 1 100 | tail --lines 3")).toEqual({ ok: true, command: "seq 1 100", tail: 3 })
		expect(parsePipeWindow("seq 1 100 | head -n 3")).toEqual({ ok: true, command: "seq 1 100", head: 3 })
		expect(parsePipeWindow("seq 1 100|tail -n 3")).toEqual({ ok: true, command: "seq 1 100", tail: 3 })
		expect(parsePipeWindow("  seq 1 100 | tail -n 3  ")).toEqual({ ok: true, command: "seq 1 100", tail: 3 })
		expect(parsePipeWindow("seq 1 100 | tail -n 3;")).toEqual({ ok: true, command: "seq 1 100", tail: 3 })
	})

	it("leaves commands without a trailing head/tail pipe alone", () => {
		expect(parsePipeWindow("seq 1 100")).toEqual({ ok: false })
		expect(parsePipeWindow("seq 1 100 | grep 1")).toEqual({ ok: false })
		expect(parsePipeWindow("seq 1 100 > out.txt")).toEqual({ ok: false })
		expect(parsePipeWindow("")).toEqual({ ok: false })
	})

	it("leaves unsupported head/tail invocations alone", () => {
		// bare head/tail without an explicit count
		expect(parsePipeWindow("seq 1 100 | tail")).toEqual({ ok: false })
		// byte mode and other flags cannot map to a line window
		expect(parsePipeWindow("seq 1 100 | head -c 100")).toEqual({ ok: false })
		expect(parsePipeWindow("seq 1 100 | tail -v -n 3")).toEqual({ ok: false })
		// zero and negative counts
		expect(parsePipeWindow("seq 1 100 | tail -n 0")).toEqual({ ok: false })
		expect(parsePipeWindow("seq 1 100 | tail -n -3")).toEqual({ ok: false })
		expect(parsePipeWindow("seq 1 100 | tail -n +5")).toEqual({ ok: false })
		// extra arguments mean the stream is not the command's own output
		expect(parsePipeWindow("seq 1 100 | tail -n 3 out.txt")).toEqual({ ok: false })
		expect(parsePipeWindow("seq 1 100 | tail -n 3 > out.txt")).toEqual({ ok: false })
		// quoting and substitution could hide more commands
		expect(parsePipeWindow("seq 1 100 | tail -n '$x'")).toEqual({ ok: false })
		expect(parsePipeWindow("seq 1 100 | $(echo tail) -n 3")).toEqual({ ok: false })
	})

	it("does not mistake quoted or escaped pipes for operators", () => {
		expect(parsePipeWindow(`echo "|tail -n 3"`)).toEqual({ ok: false })
		expect(parsePipeWindow(`echo 'a|b' | tail -n 3`)).toEqual({ ok: true, command: `echo 'a|b'`, tail: 3 })
		expect(parsePipeWindow("echo a\\|b | tail -n 3")).toEqual({ ok: true, command: "echo a\\|b", tail: 3 })
	})

	it("does not mistake list operators for stream pipes", () => {
		expect(parsePipeWindow("false || tail -n 3")).toEqual({ ok: false })
		expect(parsePipeWindow("false |& tail -n 3")).toEqual({ ok: false })
	})

	it("leaves commands that join other commands alone", () => {
		// the pipe only sees the last pipeline, the window would cover all of them
		expect(parsePipeWindow("seq 1 100 && echo done | tail -n 3")).toEqual({ ok: false })
		expect(parsePipeWindow("cd /tmp && seq 1 100 | tail -n 3")).toEqual({ ok: false })
		expect(parsePipeWindow("false || seq 1 100 | tail -n 3")).toEqual({ ok: false })
		expect(parsePipeWindow("cd /tmp; seq 1 100 | tail -n 3")).toEqual({ ok: false })
		expect(parsePipeWindow("seq 1 100 | tail -n 3; echo done")).toEqual({ ok: false })
		expect(parsePipeWindow("seq 1 100 | tail -n 3;")).toEqual({ ok: true, command: "seq 1 100", tail: 3 })
		expect(parsePipeWindow("sleep 1 & seq 1 100 | tail -n 3")).toEqual({ ok: false })
		expect(parsePipeWindow("seq 1 100\n| tail -n 3")).toEqual({ ok: false })
		expect(parsePipeWindow("cd /tmp\nseq 1 100 | tail -n 3")).toEqual({ ok: false })
		expect(parsePipeWindow("seq 1 100 \\\n | tail -n 3")).toEqual({ ok: false })
		// joins inside quotes are part of an argument, not the command
		expect(parsePipeWindow(`echo "a && b; c" | tail -n 3`)).toEqual({
			ok: true,
			command: `echo "a && b; c"`,
			tail: 3,
		})
	})

	it("allows redirections and line breaks that do not join commands", () => {
		expect(parsePipeWindow("seq 1 100 2>&1 | tail -n 3")).toEqual({
			ok: true,
			command: "seq 1 100 2>&1",
			tail: 3,
		})
		expect(parsePipeWindow("seq 1 100 |\n tail -n 3")).toEqual({ ok: true, command: "seq 1 100", tail: 3 })
		expect(parsePipeWindow("echo a\\\\ | tail -n 1")).toEqual({ ok: true, command: "echo a\\\\", tail: 1 })
	})

	it("leaves head-then-tail chains alone", () => {
		expect(parsePipeWindow("seq 1 100 | head -n 20 | tail -n 5")).toEqual({ ok: false })
		expect(parsePipeWindow("seq 1 100 | tail -n 5 | head -n 2")).toEqual({ ok: false })
	})

	it("allows a preceding head/tail pipe that is not the last segment", () => {
		expect(parsePipeWindow("seq 1 100 | head -n 50 | grep 9 | tail -n 3")).toEqual({
			ok: true,
			command: "seq 1 100 | head -n 50 | grep 9",
			tail: 3,
		})
	})
})

describe("pipesThroughHeadTail", () => {
	it("detects every supported head/tail pipe form", () => {
		for (const command of [
			"seq 1 100 | tail -n 3",
			"seq 1 100 | head -n 3",
			"seq 1 100 | head",
			"seq 1 100 | tail",
			"seq 1 100 | head -c 100",
			"seq 1 100 | tail -n 3 out.txt",
			"seq 1 100 | head -n 20 | tail -n 5",
			"seq 1 100 |\n tail -n 3",
		])
			expect(pipesThroughHeadTail(command)).toBe(true)
	})

	it("detects pipes inside joined commands", () => {
		for (const command of [
			"cd /tmp && seq 1 100 | tail -n 3",
			"cd /tmp; seq 1 100 | head -n 3",
			"false || seq 1 100 | tail -n 3",
		])
			expect(pipesThroughHeadTail(command)).toBe(true)
	})

	it("ignores commands without a head/tail pipe", () => {
		for (const command of [
			"seq 1 100",
			"seq 1 100 | grep 1",
			"seq 1 100 | headless",
			"seq 1 100 | tailwind",
			`echo "| tail -n 3"`,
			"echo 'a|b'",
			"echo a\\|b",
			"false || tail -n 3",
			"false |& tail -n 3",
			"head -n 3 file.txt",
			"tail -n 3 file.txt",
			"",
		])
			expect(pipesThroughHeadTail(command)).toBe(false)
	})
})

describe("rewritePipeWindow", () => {
	it("rewrites only shell calls", () => {
		const read = { tool: "read", input: { command: "x | tail -n 3" } }
		rewritePipeWindow(read)
		expect(read.input).toEqual({ command: "x | tail -n 3" })
	})

	it("moves the trailing pipe into the window parameters", () => {
		const input = { command: "seq 1 100 | tail -n 3" }
		rewritePipeWindow({ tool: "shell", input })
		expect(input).toEqual({ command: "seq 1 100", tail: 3 })
	})

	it("skips calls that already carry window parameters", () => {
		for (const extra of [{ tail: 5 }, { head: 5 }, { lines: { start: 2 } }]) {
			const input = { command: "seq 1 100 | tail -n 3", ...extra }
			rewritePipeWindow({ tool: "shell", input })
			expect(input).toEqual({ command: "seq 1 100 | tail -n 3", ...extra })
		}
	})

	it("skips inputs the plugin cannot rewrite", () => {
		for (const input of [undefined, null, "x", {}, { command: 5 }]) {
			const event = { tool: "shell", input }
			rewritePipeWindow(event)
			expect(event.input).toBe(input)
		}
	})
})
