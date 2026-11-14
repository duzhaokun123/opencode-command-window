import { describe, expect, it, vi } from "vitest"

import plugin from "./index.ts"
import { type SystemPartLike } from "./prompt.ts"
import { INPUT_SCHEMA, OUTPUT_WINDOW_DESCRIPTION } from "./schema.ts"

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
		async runAfter(event: unknown) {
			expect(after).toBeDefined()
			await after!(event as never)
		},
		hasTransform: () => transform !== undefined,
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

	it("injects the read-back prompt into primary requests only", async () => {
		const fake = fakeContext()
		await plugin.setup(fake.context)
		const event = { tools: { shell: { description: "Run a command" }, read: { description: "Read" } }, system: [] as SystemPartLike[] }

		fake.runSessionHook("context", event)
		expect(event.system).toHaveLength(1)
		expect(event.system[0]?.text).toContain("full output saved to <path>")

		const secondary = { ...event, system: [] as SystemPartLike[] }
		fake.runSessionHook("compaction", secondary)
		fake.runSessionHook("generate", secondary)
		expect(secondary.system).toHaveLength(0)
	})

	it("injects the prompt once per request", async () => {
		const fake = fakeContext()
		await plugin.setup(fake.context)
		const event = { tools: { shell: { description: "Run a command" }, read: { description: "Read" } }, system: [] as SystemPartLike[] }

		fake.runSessionHook("context", event)
		fake.runSessionHook("context", event)
		expect(event.system).toHaveLength(1)
	})

	it("skips the prompt when readBack is disabled", async () => {
		const fake = fakeContext(undefined, { readBack: false })
		await plugin.setup(fake.context)
		const event = { tools: { shell: { description: "Run a command" }, read: { description: "Read" } }, system: [] as SystemPartLike[] }

		fake.runSessionHook("context", event)
		expect(event.system).toHaveLength(0)
	})

	it("skips the prompt when the read tool is absent", async () => {
		const fake = fakeContext()
		await plugin.setup(fake.context)
		const event = { tools: { shell: { description: "Run a command" } }, system: [] as SystemPartLike[] }

		fake.runSessionHook("context", event)
		expect(event.system).toHaveLength(0)
	})

	it("uses a custom read-back text", async () => {
		const fake = fakeContext(undefined, { readBackText: "Use read please." })
		await plugin.setup(fake.context)
		const event = { tools: { shell: { description: "Run a command" }, read: { description: "Read" } }, system: [] as SystemPartLike[] }

		fake.runSessionHook("context", event)
		expect(event.system.map((part) => part.text)).toEqual(["Use read please."])
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
})
