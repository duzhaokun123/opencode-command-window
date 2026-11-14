/** How many ms a scan may spend on one call. */
export const SCAN_TIMEOUT_MS = 5_000

export const DEFAULT_MAX_BYTES = 200 * 1024

export const MAX_BYTES_LIMIT = 5 * 1024 * 1024

export type WindowSpec =
	| { kind: "tail"; tail: number }
	| { kind: "head"; head: number }
	| { kind: "headtail"; head: number; tail: number }
	| { kind: "range"; start: number; end?: number }

export type ParsedWindow =
	| { ok: true; spec: WindowSpec; maxBytes: number; clamped: boolean }
	| { ok: false; reason: string }
	| { ok: false; none: true }

const NONE: ParsedWindow = { ok: false, none: true }

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function integerAtLeast(value: unknown, minimum: number): number | undefined {
	return typeof value === "number" && Number.isInteger(value) && value >= minimum ? value : undefined
}

function linesField(value: unknown): { start: number; end?: number } | string {
	if (!isRecord(value)) return "lines must be an object with a start field"
	const start = integerAtLeast(value.start, 1)
	if (start === undefined) return "lines.start must be an integer greater than or equal to 1"
	if (value.end === undefined) return { start }
	const end = integerAtLeast(value.end, 1)
	if (end === undefined) return "lines.end must be an integer greater than or equal to 1"
	if (end < start) return "lines.end must be greater than or equal to lines.start"
	return { start, end }
}

/**
 * Normalize the window parameters of one shell call. A `none` result means the
 * call asked for no window, so the caller must leave the tool result untouched.
 */
export function parseWindow(input: unknown): ParsedWindow {
	if (!isRecord(input)) return NONE

	if (input.tail !== undefined && integerAtLeast(input.tail, 0) === undefined)
		return { ok: false, reason: "tail must be an integer greater than or equal to 0" }
	if (input.head !== undefined && integerAtLeast(input.head, 0) === undefined)
		return { ok: false, reason: "head must be an integer greater than or equal to 0" }
	if (input.lines !== undefined && !isRecord(input.lines))
		return { ok: false, reason: "lines must be an object with a start field" }

	const tail = integerAtLeast(input.tail, 0) ?? 0
	const head = integerAtLeast(input.head, 0) ?? 0
	const rawMax = integerAtLeast(input.max_bytes, 1)
	const maxBytes = Math.min(rawMax ?? DEFAULT_MAX_BYTES, MAX_BYTES_LIMIT)
	const clamped = rawMax !== undefined && rawMax > MAX_BYTES_LIMIT

	const lines = input.lines === undefined ? undefined : linesField(input.lines)
	if (typeof lines === "string") return { ok: false, reason: lines }

	if (lines !== undefined && (head > 0 || tail > 0))
		return { ok: false, reason: "lines cannot be combined with head or tail" }

	if (lines !== undefined) return { ok: true, spec: { kind: "range", ...lines }, maxBytes, clamped }
	if (head > 0 && tail > 0) return { ok: true, spec: { kind: "headtail", head, tail }, maxBytes, clamped }
	if (head > 0) return { ok: true, spec: { kind: "head", head }, maxBytes, clamped }
	if (tail > 0) return { ok: true, spec: { kind: "tail", tail }, maxBytes, clamped }
	return NONE
}

export type MarkerRange = { start: number; end: number }

export type MarkerInput = {
	spec: WindowSpec
	ranges: ReadonlyArray<MarkerRange>
	total: number
	totalKnown: boolean
	/** Present only when OpenCode saved the complete output to a file. */
	savedPath?: string
	capped: boolean
	stoppedEarly: boolean
	clamped: boolean
	maxBytes: number
}

function describeSpec(spec: WindowSpec): string {
	switch (spec.kind) {
		case "tail":
			return `tail ${spec.tail}`
		case "head":
			return `head ${spec.head}`
		case "headtail":
			return `head ${spec.head}, tail ${spec.tail}`
		case "range":
			return spec.end === undefined ? `lines ${spec.start}-` : `lines ${spec.start}-${spec.end}`
	}
}

function describeRanges(ranges: ReadonlyArray<MarkerRange>): string {
	const parts = ranges.map((range) => `${range.start}-${range.end}`)
	if (parts.length <= 1) return parts[0] ?? ""
	return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`
}

export function renderMarker(input: MarkerInput): string {
	const total = input.totalKnown ? String(input.total) : `at least ${input.total}`
	const spec = describeSpec(input.spec)
	let body: string
	if (input.total === 0) body = `showing 0 lines of 0 (${spec})`
	else if (input.ranges.length === 0) body = `no lines in the requested range; total ${total} (${spec})`
	else body = `showing lines ${describeRanges(input.ranges)} of ${total} (${spec})`

	const notes: string[] = []
	if (input.capped) notes.push(`capped at ${input.maxBytes} bytes`)
	if (input.stoppedEarly) notes.push(`scan stopped after ${SCAN_TIMEOUT_MS} ms`)
	if (input.clamped) notes.push(`max_bytes clamped to ${MAX_BYTES_LIMIT}`)
	const details = notes.map((note) => `; ${note}`).join("")
	const suffix =
		input.savedPath === undefined
			? "; full output was not saved because the result was not truncated"
			: `; full output saved to ${input.savedPath}`
	return `[${body}${details}${suffix}]`
}
