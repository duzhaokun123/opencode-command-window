import { DEFAULT_READ_BACK_TEXT, DEFAULT_WINDOW_HINT_TEXT } from "./prompt.ts"

/** Options read from the plugin entry's `options` object in `opencode.json(c)`. */
export interface Options {
	readonly readBack: boolean
	readonly readBackText: string
	readonly windowHint: boolean
	readonly windowHintText: string
}

export const DEFAULT_OPTIONS: Options = {
	readBack: true,
	readBackText: DEFAULT_READ_BACK_TEXT,
	windowHint: true,
	windowHintText: DEFAULT_WINDOW_HINT_TEXT,
}

function warn(message: string): void {
	console.warn(`[command.window] ${message}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Normalize the plugin options. Invalid values fall back to their defaults and log
 * one warning each; this never throws, because setup must still register the plugin.
 */
export function resolveOptions(raw: unknown): Options {
	if (!isRecord(raw)) {
		if (raw !== undefined) warn("options must be an object; using the defaults")
		return DEFAULT_OPTIONS
	}

	const readBack = typeof raw.readBack === "boolean" ? raw.readBack : undefined
	if (raw.readBack !== undefined && readBack === undefined)
		warn("readBack must be a boolean; using the default (true)")

	const customReadBackText =
		typeof raw.readBackText === "string" && raw.readBackText.trim().length > 0 ? raw.readBackText : undefined
	if (raw.readBackText !== undefined && customReadBackText === undefined)
		warn("readBackText must be a non-empty string; using the default text")

	const windowHint = typeof raw.windowHint === "boolean" ? raw.windowHint : undefined
	if (raw.windowHint !== undefined && windowHint === undefined)
		warn("windowHint must be a boolean; using the default (true)")

	const customWindowHintText =
		typeof raw.windowHintText === "string" && raw.windowHintText.trim().length > 0 ? raw.windowHintText : undefined
	if (raw.windowHintText !== undefined && customWindowHintText === undefined)
		warn("windowHintText must be a non-empty string; using the default text")

	return {
		readBack: readBack ?? DEFAULT_OPTIONS.readBack,
		readBackText: customReadBackText ?? DEFAULT_OPTIONS.readBackText,
		windowHint: windowHint ?? DEFAULT_OPTIONS.windowHint,
		windowHintText: customWindowHintText ?? DEFAULT_OPTIONS.windowHintText,
	}
}
