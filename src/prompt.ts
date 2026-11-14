/** Appended to the system prompt so the model reads saved output instead of rerunning commands. */
export const DEFAULT_READ_BACK_TEXT =
	"Saved shell output: when a shell result reports `full output saved to <path>`, the complete output is in that file. Read that file with the read tool by passing path together with offset (the 1-based first line) and limit (at most 2000 lines per call), and continue from the offset reported by [Output truncated. Continue reading with offset: N]. Do not rerun the command just to see another part of its output. The line numbers the read tool prints are prefixes for reference, and they match the 1-based numbering used by the shell lines window. The saved file is outside the workspace, so the first read may ask for directory approval."

/** Appended to the system prompt so the model windows output with tool parameters instead of piping through head or tail. */
export const DEFAULT_WINDOW_HINT_TEXT =
	"Shell output window: to limit how much of a command's output you see, pass the shell tool's `head`, `tail`, `lines`, or `max_bytes` parameters instead of appending `| head` or `| tail` to the command. `head` and `tail` take line counts from the start and the end and may be combined; `lines` takes an exact 1-based inclusive range; `max_bytes` caps the returned bytes. Piping through `head` or `tail` hides the total line count and the saved-output path, and can stop the command early. When you need matching lines rather than a range, filter inside the command (for example with `grep`) instead."

const SOURCE = { plugin: "command.window" } as const

/** The kinds of paragraphs this plugin appends to a request's system prompt. */
type HintKind = "read-back" | "window-hint"

/** The subset of a `SystemPart` this module writes and inspects. */
export type SystemPartLike = {
	readonly type: "text"
	readonly text: string
	readonly metadata?: Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isHintPart(value: unknown, kind: HintKind): boolean {
	if (!isRecord(value) || !isRecord(value.metadata)) return false
	return value.metadata.plugin === SOURCE.plugin && value.metadata.kind === kind
}

/** Append one tagged paragraph. Returns false when the request already carries that kind. */
function injectHint(system: SystemPartLike[], kind: HintKind, text: string): boolean {
	if (system.some((part) => isHintPart(part, kind))) return false
	system.push({ type: "text", text, metadata: { ...SOURCE, kind } })
	return true
}

/**
 * Append the window-parameter paragraph to one request's system prompt. Returns false when
 * the request already carries it, so repeated hook runs never duplicate the text.
 */
export function injectWindowHint(system: SystemPartLike[], text: string): boolean {
	return injectHint(system, "window-hint", text)
}

/**
 * Append the read-back paragraph to one request's system prompt. Returns false when
 * the request already carries it, so repeated hook runs never duplicate the text.
 */
export function injectReadBack(system: SystemPartLike[], text: string): boolean {
	return injectHint(system, "read-back", text)
}
