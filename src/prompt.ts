/** Appended to the system prompt so the model reads saved output instead of rerunning commands. */
export const DEFAULT_READ_BACK_TEXT =
	"Saved shell output: when a shell result reports `full output saved to <path>`, the complete output is in that file. Read that file with the read tool by passing path together with offset (the 1-based first line) and limit (at most 2000 lines per call), and continue from the offset reported by [Output truncated. Continue reading with offset: N]. Do not rerun the command just to see another part of its output. The line numbers the read tool prints are prefixes for reference, and they match the 1-based numbering used by the shell lines window. The saved file is outside the workspace, so the first read may ask for directory approval."

const READ_BACK_SOURCE = { plugin: "command.window", kind: "read-back" } as const

/** The subset of a `SystemPart` this module writes and inspects. */
export type SystemPartLike = {
	readonly type: "text"
	readonly text: string
	readonly metadata?: Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isReadBackPart(value: unknown): boolean {
	if (!isRecord(value) || !isRecord(value.metadata)) return false
	return value.metadata.plugin === READ_BACK_SOURCE.plugin && value.metadata.kind === READ_BACK_SOURCE.kind
}

/**
 * Append the read-back paragraph to one request's system prompt. Returns false when
 * the request already carries it, so repeated hook runs never duplicate the text.
 */
export function injectReadBack(system: SystemPartLike[], text: string): boolean {
	if (system.some(isReadBackPart)) return false
	system.push({ type: "text", text, metadata: { ...READ_BACK_SOURCE } })
	return true
}
