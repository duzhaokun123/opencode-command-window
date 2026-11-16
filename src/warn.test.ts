import { describe, expect, it } from "vitest"

import { applyPipeWarning, DEFAULT_PIPE_WARNING_TEXT } from "./warn.ts"

function shellEvent(command: string, extra: Record<string, unknown> = {}) {
	return {
		tool: "shell",
		status: "completed",
		input: { command },
		result: {
			output: { output: "1\n2\n3" },
			content: [{ type: "text", text: "1\n2\n3" }],
			metadata: { status: "completed" },
		},
		...extra,
	}
}

describe("applyPipeWarning", () => {
	it("prepends the warning when the command pipes through head or tail", () => {
		for (const command of [
			"seq 1 100 | tail -n 3",
			"seq 1 100 | head -n 3",
			"seq 1 100 | head",
			"seq 1 100 | head -c 100",
			"seq 1 100 | tail -n 3 out.txt",
			"cd /tmp && seq 1 100 | tail -n 3",
			"seq 1 100 | head -n 3 | tail -n 1",
		]) {
			const event = shellEvent(command)
			applyPipeWarning(event, DEFAULT_PIPE_WARNING_TEXT)
			expect(event.result.content[0]).toEqual({
				type: "text",
				text: `[window warning: ${DEFAULT_PIPE_WARNING_TEXT}]`,
			})
			expect(event.result.content[1]).toEqual({ type: "text", text: "1\n2\n3" })
			expect(event.result.output).toEqual({ output: "1\n2\n3" })
			expect(event.result.metadata).toEqual({ status: "completed" })
		}
	})

	it("leaves commands without a head/tail pipe alone", () => {
		for (const command of [
			"seq 1 100",
			"seq 1 100 | grep 1",
			`echo "| tail -n 3"`,
			"false || tail -n 3",
			"false |& tail -n 3",
			"seq 1 100 | headless",
		]) {
			const event = shellEvent(command)
			const before = event.result
			applyPipeWarning(event, DEFAULT_PIPE_WARNING_TEXT)
			expect(event.result).toBe(before)
		}
	})

	it("keeps every existing content part after the warning", () => {
		const event = shellEvent("seq 1 3 | tail -n 1")
		event.result.content.push({ type: "text", text: "[exit code: 1]" })
		applyPipeWarning(event, DEFAULT_PIPE_WARNING_TEXT)
		expect(event.result.content.map((part) => ("text" in part ? part.text : ""))).toEqual([
			`[window warning: ${DEFAULT_PIPE_WARNING_TEXT}]`,
			"1\n2\n3",
			"[exit code: 1]",
		])
	})

	it("uses a custom text", () => {
		const event = shellEvent("seq 1 3 | head -n 1")
		applyPipeWarning(event, "Use the window parameters.")
		expect(event.result.content[0]).toEqual({ type: "text", text: "[window warning: Use the window parameters.]" })
	})

	it("leaves other tools and unfinished results alone", () => {
		for (const event of [
			{ ...shellEvent("seq 1 3 | tail -n 1"), tool: "read" },
			{ ...shellEvent("seq 1 3 | tail -n 1"), status: "failed" },
			{ ...shellEvent("seq 1 3 | tail -n 1"), result: undefined },
			{
				...shellEvent("seq 1 3 | tail -n 1"),
				result: { ...shellEvent("seq 1 3 | tail -n 1").result, metadata: { status: "running" } },
			},
			{
				...shellEvent("seq 1 3 | tail -n 1"),
				result: { ...shellEvent("seq 1 3 | tail -n 1").result, metadata: { killed: true } },
			},
		]) {
			const before = event.result
			applyPipeWarning(event, DEFAULT_PIPE_WARNING_TEXT)
			expect(event.result).toBe(before)
		}
	})

	it("leaves input it cannot read alone", () => {
		for (const input of [undefined, null, "command", [], {}, { command: 1 }]) {
			const event = { tool: "shell", status: "completed", input, result: { content: [] } }
			applyPipeWarning(event, DEFAULT_PIPE_WARNING_TEXT)
			expect(event.result).toEqual({ content: [] })
		}
	})
})
