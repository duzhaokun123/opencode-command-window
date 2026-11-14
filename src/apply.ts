import { inspectFile, scan, type ScanSource } from "./scan.ts"
import { parseWindow, renderMarker } from "./window.ts"

type TextPart = { type: "text"; text: string }

export type ResultLike = {
	readonly output?: unknown
	readonly content?: string | ReadonlyArray<unknown>
	readonly metadata?: Readonly<Record<string, unknown>>
}

/** The subset of the `execute.after` event this plugin reads and replaces. */
export type AfterEventLike = {
	readonly tool: string
	readonly status: string
	readonly input: unknown
	result?: ResultLike
}

type ShellOutput = { output: string; outputPath?: string } & Record<string, unknown>

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isTextPart(value: unknown): value is TextPart {
	return isRecord(value) && value.type === "text" && typeof value.text === "string"
}

function shellOutput(value: unknown): ShellOutput | undefined {
	if (!isRecord(value) || typeof value.output !== "string") return undefined
	return value as ShellOutput
}

/** Total line count from the marker the built-in truncation appends. */
export function parseTotalHint(text: string): number | undefined {
	const lines = /\[showing lines \d+-\d+ of (\d+);/.exec(text)
	if (lines !== null) return Number(lines[1])
	const single = /\[showing the last .*? of line (\d+) \(/.exec(text)
	if (single !== null) return Number(single[1])
	return undefined
}

/** True when the inline text is a truncated preview rather than the complete output. */
export function isTruncatedPreview(text: string): boolean {
	return /\[showing (?:lines \d+-\d+ of \d+|the last [^\]]*?); full output saved to /.test(text)
}

function parts(content: ResultLike["content"]): unknown[] {
	if (typeof content === "string") return [{ type: "text", text: content }]
	return content === undefined ? [] : [...content]
}

function prependNote(result: ResultLike, note: string): ResultLike {
	return { ...result, content: [{ type: "text", text: note }, ...parts(result.content)] }
}

/** Replace the body part (the one equal to `output.output`) and keep every other part. */
function replaceBody(
	result: ResultLike,
	output: ShellOutput,
	text: string,
	window: Record<string, unknown>,
	partial: boolean,
): ResultLike {
	const rest: unknown[] = []
	let replaced = false
	for (const part of parts(result.content)) {
		if (!replaced && isTextPart(part) && part.text === output.output) {
			replaced = true
			continue
		}
		rest.push(part)
	}
	return {
		...result,
		content: [{ type: "text", text }, ...rest],
		output: { ...output, output: text },
		metadata: { ...(result.metadata ?? {}), truncated: partial, window },
	}
}

/**
 * Apply a window to one completed shell result. Never throws for a predictable
 * failure: the result is left alone and a note is prepended instead.
 */
export async function applyWindow(event: AfterEventLike): Promise<void> {
	if (event.tool !== "shell" || event.status !== "completed" || event.result === undefined) return
	const parsed = parseWindow(event.input)
	if (!parsed.ok && "none" in parsed) return

	const result = event.result
	const output = shellOutput(result.output)
	if (output === undefined) return

	const metadata = result.metadata ?? {}
	if (metadata.status === "running" || metadata.killed !== undefined) return

	if (!parsed.ok) {
		event.result = prependNote(
			result,
			`[window error: ${parsed.reason}; returning the default preview. Valid combinations: tail, head, tail+head, lines.]`,
		)
		return
	}

	const path = typeof output.outputPath === "string" ? output.outputPath : undefined
	let source: ScanSource
	let hint: number | undefined
	if (path !== undefined) {
		const info = await inspectFile(path)
		if (info === undefined) {
			event.result = prependNote(
				result,
				"[window not applied: the full output file is unavailable; showing the default preview.]",
			)
			return
		}
		if (info.binary) {
			event.result = replaceBody(result, output, `[output is binary; ${info.size} bytes at ${path}]`, {
				mode: "binary",
				totalBytes: info.size,
			}, false)
			return
		}
		source = { kind: "file", path }
		hint = parseTotalHint(output.output)
	} else {
		if (isTruncatedPreview(output.output)) {
			event.result = prependNote(
				result,
				"[window not applied: the full output is unavailable; showing the default preview.]",
			)
			return
		}
		source = { kind: "text", text: output.output === "(no output)" ? "" : output.output }
	}

	const scanned = await scan(source, parsed.spec, {
		maxBytes: parsed.maxBytes,
		...(hint === undefined ? {} : { hintTotal: hint }),
	})
	const marker = renderMarker({
		spec: parsed.spec,
		ranges: scanned.ranges,
		total: scanned.total,
		totalKnown: scanned.totalKnown,
		...(path === undefined ? {} : { savedPath: path }),
		capped: scanned.capped,
		stoppedEarly: scanned.stoppedEarly,
		clamped: parsed.clamped,
		maxBytes: parsed.maxBytes,
	})
	const text =
		scanned.total === 0 && scanned.shown === 0
			? `(no output)\n\n${marker}`
			: scanned.text === ""
				? marker
				: `${scanned.text}\n\n${marker}`
	const partial =
		!scanned.totalKnown || scanned.shown < scanned.total || scanned.capped || scanned.stoppedEarly

	event.result = replaceBody(
		result,
		output,
		text,
		{
			mode: parsed.spec.kind,
			shownLines: scanned.shown,
			totalLines: scanned.total,
			maxBytes: parsed.maxBytes,
			clamped: parsed.clamped,
		},
		partial,
	)
}
