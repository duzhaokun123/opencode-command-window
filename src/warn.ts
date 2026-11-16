import type { AfterEventLike, ResultLike } from "./apply.ts"
import { pipesThroughHeadTail } from "./pipe.ts"

/** Prepended to a completed shell result whose command piped through `head` or `tail`. */
export const DEFAULT_PIPE_WARNING_TEXT =
	"Piping through `head` or `tail` hides the total line count and the saved-output path, and can stop the command early. Next time pass the shell tool's `head`, `tail`, `lines`, or `max_bytes` parameters instead of appending `| head` or `| tail`."

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parts(content: ResultLike["content"]): unknown[] {
	if (typeof content === "string") return [{ type: "text", text: content }]
	return content === undefined ? [] : [...content]
}

/**
 * Prepend an advisory note when a completed shell call piped its output through
 * `head` or `tail` instead of using the window parameters. The note goes first so
 * the model reads it before the output it hides. A call the plugin cannot read,
 * a running or killed result, and a command without such a pipe are left alone.
 */
export function applyPipeWarning(event: AfterEventLike, text: string): void {
	if (event.tool !== "shell" || event.status !== "completed" || event.result === undefined) return
	const input = event.input
	if (!isRecord(input) || typeof input.command !== "string") return
	if (!pipesThroughHeadTail(input.command)) return
	const metadata = event.result.metadata ?? {}
	if (metadata.status === "running" || metadata.killed !== undefined) return

	event.result = {
		...event.result,
		content: [{ type: "text", text: `[window warning: ${text}]` }, ...parts(event.result.content)],
	}
}
