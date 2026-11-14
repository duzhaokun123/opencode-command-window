import { Plugin } from "@opencode/plugin"

import { applyWindow } from "./apply.ts"
import { resolveOptions } from "./options.ts"
import { injectReadBack, injectWindowHint, type SystemPartLike } from "./prompt.ts"
import { DESCRIPTION_MARKER, INPUT_SCHEMA, OUTPUT_WINDOW_DESCRIPTION } from "./schema.ts"

const SHELL = "shell"
const READ = "read"

/** The subset of a session request this plugin reads and edits. */
type SessionEvent = {
	readonly tools: Record<string, { description: string }>
	system: SystemPartLike[]
}

function withWindowDescription(description: string): string {
	if (description.includes(DESCRIPTION_MARKER)) return description
	return `${description}\n\n${OUTPUT_WINDOW_DESCRIPTION}`
}

export default Plugin.define({
	id: "command.window",
	async setup(ctx) {
		const options = resolveOptions(ctx.options)

		const tools = await ctx.tool.list()
		if (!tools.some((tool) => tool.id === SHELL)) return

		await ctx.tool.transform((editor) => {
			if (editor.get(SHELL) === undefined) return
			editor.update(SHELL, (tool) => {
				tool.description = withWindowDescription(tool.description)
				tool.input = INPUT_SCHEMA
			})
		})

		const describe = (event: SessionEvent) => {
			const tool = event.tools[SHELL]
			if (tool !== undefined) tool.description = withWindowDescription(tool.description)
		}
		const withPrompts = (event: SessionEvent) => {
			describe(event)
			if (options.windowHint && event.tools[SHELL] !== undefined) {
				try {
					injectWindowHint(event.system, options.windowHintText)
				} catch (error) {
					console.warn("[command.window] failed to inject the output-window prompt", error)
				}
			}
			if (options.readBack && event.tools[READ] !== undefined) {
				try {
					injectReadBack(event.system, options.readBackText)
				} catch (error) {
					console.warn("[command.window] failed to inject the read-back prompt", error)
				}
			}
		}
		await ctx.session.hook("context", withPrompts)
		await ctx.session.hook("compaction", describe)
		await ctx.session.hook("generate", describe)

		await ctx.tool.hook("execute.after", async (event) => {
			try {
				await applyWindow(event)
			} catch (error) {
				console.warn("[command.window] failed to apply the output window", error)
			}
		})
	},
})
