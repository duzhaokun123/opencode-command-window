import { describe, expect, it, vi } from "vitest"

import plugin from "./index.ts"
import { DEFAULT_READ_BACK_TEXT, DEFAULT_WINDOW_HINT_TEXT, type SystemPartLike } from "./prompt.ts"
import { INPUT_SCHEMA, OUTPUT_WINDOW_DESCRIPTION } from "./schema.ts"
import { DEFAULT_PIPE_WARNING_TEXT } from "./warn.ts"

type SetupContext = Parameters<typeof plugin.setup>[0]
type ToolEditor = Parameters<Parameters<SetupContext["tool"]["transform"]>[0]>[0]

type TestTool = {
	id: string
	name: string
	description: string
	input: unknown
}

function fakeContext(
	tools: TestTool[] = [{ id: "shell", name: "shell", description: "Run a command", input: {} }],
	options: Record<string, unknown> = {},
) {
	let transform: ((editor: ToolEditor) => void) | undefined
	let before: ((event: never) => Promise<void> | void) | undefined
	let after: ((event: never) => Promise<void> | void) | undefined
	const sessionHooks = new Map<string, (event: never) => void>()
	const list = vi.fn(async () => tools)
	const context = {
		options,
		tool: {
			list,
			transform: async (callback: (editor: ToolEditor) => void) => {
				transform = callback
				return { dispose: async () => {} }
			},
			hook: async (name: string, callback: (event: never) => Promise<void> | void) => {
				if (name === "execute.before") before = callback
				if (name === "execute.after") after = callback
				return { dispose: async () => {} }
			},
		},
		session: {
			hook: async (name: string, callback: (event: never) => void) => {
				sessionHooks.set(name, callback)
				return { dispose: async () => {} }
			},
		},
	}
	return {
		context: context as unknown as SetupContext,
		list,
		runTransform(editor: ToolEditor) {
			expect(transform).toBeDefined()
			transform!(editor)
		},
		runSessionHook(
			name: string,
			event: { tools: Record<string, { description: string }>; system: SystemPartLike[] },
		) {
			expect(sessionHooks.has(name)).toBe(true)
			sessionHooks.get(name)!(event as never)
		},
		runBefore(event: unknown) {
			expect(before).toBeDefined()
			before!(event as never)
		},
		async runAfter(event: unknown) {
			expect(after).toBeDefined()
			await after!(event as never)
		},
		hasTransform: () => transform !== undefined,
		hasBefore: () => before !== undefined,
		hasAfter: () => after !== undefined,
	}
}

describe("plugin setup", () => {
	it("does nothing when the shell tool is absent", async () => {
		const fake = fakeContext([])
		await plugin.setup(fake.context)
		expect(fake.list).toHaveBeenCalledOnce()
		expect(fake.hasTransform()).toBe(false)
		expect(fake.hasAfter()).toBe(false)
	})

	it("replaces the shell input schema and appends the description", async () => {
		const fake = fakeContext()
		await plugin.setup(fake.context)
		const tool: TestTool = { id: "shell", name: "shell", description: "Run a command", input: {} }
		fake.runTransform({
			get: (id: string) => (id === "shell" ? tool : undefined),
			update: (_id: string, update: (value: TestTool) => void) => update(tool),
		} as unknown as ToolEditor)
		expect(tool.input).toBe(INPUT_SCHEMA)
		expect(tool.description).toBe(`Run a command\n\n${OUTPUT_WINDOW_DESCRIPTION}`)
	})

	it("appends the description on every session request without duplicating it", async () => {
		const fake = fakeContext()
		await plugin.setup(fake.context)
		for (const name of ["context", "compaction", "generate"]) {
			const event = { tools: { shell: { description: "Run a command" } }, system: [] as SystemPartLike[] }
			fake.runSessionHook(name, event)
			fake.runSessionHook(name, event)
			expect(event.tools.shell.description).toBe(`Run a command\n\n${OUTPUT_WINDOW_DESCRIPTION}`)
		}
	})

	it("injects both prompts into primary requests only", async () => {
		const fake = fakeContext()
		await plugin.setup(fake.context)
		const event = { tools: { shell: { description: "Run a command" }, read: { description: "Read" } }, system: [] as SystemPartLike[] }

		fake.runSessionHook("context", event)
		expect(event.system.map((part) => part.metadata?.kind)).toEqual(["window-hint", "read-back"])
		expect(event.system[0]?.text).toContain("| head")
		expect(event.system[1]?.text).toContain("full output saved to <path>")

		const secondary = { ...event, system: [] as SystemPartLike[] }
		fake.runSessionHook("compaction", secondary)
		fake.runSessionHook("generate", secondary)
		expect(secondary.system).toHaveLength(0)
	})

	it("injects each prompt once per request", async () => {
		const fake = fakeContext()
		await plugin.setup(fake.context)
		const event = { tools: { shell: { description: "Run a command" }, read: { description: "Read" } }, system: [] as SystemPartLike[] }

		fake.runSessionHook("context", event)
		fake.runSessionHook("context", event)
		expect(event.system).toHaveLength(2)
	})

	it("keeps the window hint when readBack is disabled", async () => {
		const fake = fakeContext(undefined, { readBack: false })
		await plugin.setup(fake.context)
		const event = { tools: { shell: { description: "Run a command" }, read: { description: "Read" } }, system: [] as SystemPartLike[] }

		fake.runSessionHook("context", event)
		expect(event.system.map((part) => part.metadata?.kind)).toEqual(["window-hint"])
	})

	it("skips the window hint when windowHint is disabled", async () => {
		const fake = fakeContext(undefined, { windowHint: false })
		await plugin.setup(fake.context)
		const event = { tools: { shell: { description: "Run a command" }, read: { description: "Read" } }, system: [] as SystemPartLike[] }

		fake.runSessionHook("context", event)
		expect(event.system.map((part) => part.metadata?.kind)).toEqual(["read-back"])
	})

	it("skips the read-back prompt when the read tool is absent", async () => {
		const fake = fakeContext()
		await plugin.setup(fake.context)
		const event = { tools: { shell: { description: "Run a command" } }, system: [] as SystemPartLike[] }

		fake.runSessionHook("context", event)
		expect(event.system.map((part) => part.metadata?.kind)).toEqual(["window-hint"])
	})

	it("skips the window hint when the shell tool is absent", async () => {
		const fake = fakeContext()
		await plugin.setup(fake.context)
		const event = { tools: { read: { description: "Read" } }, system: [] as SystemPartLike[] }

		fake.runSessionHook("context", event)
		expect(event.system.map((part) => part.metadata?.kind)).toEqual(["read-back"])
	})

	it("uses a custom read-back text", async () => {
		const fake = fakeContext(undefined, { readBackText: "Use read please." })
		await plugin.setup(fake.context)
		const event = { tools: { shell: { description: "Run a command" }, read: { description: "Read" } }, system: [] as SystemPartLike[] }

		fake.runSessionHook("context", event)
		expect(event.system.map((part) => part.text)).toEqual([DEFAULT_WINDOW_HINT_TEXT, "Use read please."])
	})

	it("uses a custom window hint text", async () => {
		const fake = fakeContext(undefined, { windowHintText: "Use window parameters." })
		await plugin.setup(fake.context)
		const event = { tools: { shell: { description: "Run a command" }, read: { description: "Read" } }, system: [] as SystemPartLike[] }

		fake.runSessionHook("context", event)
		expect(event.system.map((part) => part.text)).toEqual(["Use window parameters.", DEFAULT_READ_BACK_TEXT])
	})

	it("applies windows through execute.after", async () => {
		const fake = fakeContext()
		await plugin.setup(fake.context)
		const event = {
			tool: "shell",
			status: "completed",
			input: { command: "x", tail: 2 },
			result: {
				output: { output: "1\n2\n3" },
				content: [{ type: "text", text: "1\n2\n3" }],
				metadata: { status: "completed", truncated: false },
			},
		}
		await fake.runAfter(event)
		expect((event.result.output as { output: string }).output).toContain("(tail 2)")
	})

	it("does not warn about head/tail pipes by default", async () => {
		const fake = fakeContext()
		await plugin.setup(fake.context)
		const event = {
			tool: "shell",
			status: "completed",
			input: { command: "seq 1 3 | tail -n 1" },
			result: {
				output: { output: "3" },
				content: [{ type: "text", text: "3" }],
				metadata: { status: "completed" },
			},
		}
		await fake.runAfter(event)
		expect(event.result.content).toEqual([{ type: "text", text: "3" }])
	})

	it("warns about head/tail pipes when pipeWarning is enabled", async () => {
		const fake = fakeContext(undefined, { pipeWarning: true })
		await plugin.setup(fake.context)
		const event = {
			tool: "shell",
			status: "completed",
			input: { command: "seq 1 3 | tail -n 1" },
			result: {
				output: { output: "3" },
				content: [{ type: "text", text: "3" }],
				metadata: { status: "completed" },
			},
		}
		await fake.runAfter(event)
		expect(event.result.content).toEqual([
			{ type: "text", text: `[window warning: ${DEFAULT_PIPE_WARNING_TEXT}]` },
			{ type: "text", text: "3" },
		])
	})

	it("warns with a custom pipe warning text", async () => {
		const fake = fakeContext(undefined, { pipeWarning: true, pipeWarningText: "Use window parameters." })
		await plugin.setup(fake.context)
		const event = {
			tool: "shell",
			status: "completed",
			input: { command: "seq 1 3 | head -n 1" },
			result: {
				output: { output: "1" },
				content: [{ type: "text", text: "1" }],
				metadata: { status: "completed" },
			},
		}
		await fake.runAfter(event)
		expect(event.result.content[0]).toEqual({ type: "text", text: "[window warning: Use window parameters.]" })
	})

	it("never rejects from the execute.after hook", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		try {
			const fake = fakeContext()
			await plugin.setup(fake.context)
			const input = { command: "x" }
			Object.defineProperty(input, "tail", {
				get() {
					throw new Error("boom")
				},
			})
			await expect(
				fake.runAfter({
					tool: "shell",
					status: "completed",
					input,
					result: { output: { output: "x" }, content: [] },
				}),
			).resolves.toBeUndefined()
			expect(warn).toHaveBeenCalled()
		} finally {
			warn.mockRestore()
		}
	})

	it("does not register the execute.before hook by default", async () => {
		const fake = fakeContext()
		await plugin.setup(fake.context)
		expect(fake.hasBefore()).toBe(false)
	})

	it("rewrites a trailing head/tail pipe when pipeWindow is enabled", async () => {
		const fake = fakeContext(undefined, { pipeWindow: true })
		await plugin.setup(fake.context)
		expect(fake.hasBefore()).toBe(true)

		const input = { command: "seq 1 100 | tail -n 3" }
		fake.runBefore({ tool: "shell", input })
		expect(input).toEqual({ command: "seq 1 100", tail: 3 })
	})

	it("never rejects from the execute.before hook", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		try {
			const fake = fakeContext(undefined, { pipeWindow: true })
			await plugin.setup(fake.context)
			const input = {}
			Object.defineProperty(input, "command", {
				get() {
					throw new Error("boom")
				},
			})
			fake.runBefore({ tool: "shell", input })
			expect(warn).toHaveBeenCalled()
		} finally {
			warn.mockRestore()
		}
	})
})
