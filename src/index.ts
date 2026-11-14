import { Plugin } from "@opencode/plugin"

import { applyWindow } from "./apply.ts"
import { DESCRIPTION_MARKER, INPUT_SCHEMA, OUTPUT_WINDOW_DESCRIPTION } from "./schema.ts"

const SHELL = "shell"

function withWindowDescription(description: string): string {
	if (description.includes(DESCRIPTION_MARKER)) return description
	return `${description}\n\n${OUTPUT_WINDOW_DESCRIPTION}`
}

export default Plugin.define({
	id: "command.window",
	async setup(ctx) {
		const tools = await ctx.tool.list()
		if (!tools.some((tool) => tool.id === SHELL)) return

		await ctx.tool.transform((editor) => {
			if (editor.get(SHELL) === undefined) return
			editor.update(SHELL, (tool) => {
				tool.description = withWindowDescription(tool.description)
				tool.input = INPUT_SCHEMA
			})
		})

		const describe = (event: { tools: Record<string, { description: string }> }) => {
			const tool = event.tools[SHELL]
			if (tool !== undefined) tool.description = withWindowDescription(tool.description)
		}
		await ctx.session.hook("context", describe)
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
