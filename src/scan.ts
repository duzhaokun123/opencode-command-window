import { createReadStream } from "node:fs"
import { open, stat } from "node:fs/promises"
import { createInterface } from "node:readline"

import { SCAN_TIMEOUT_MS, type WindowSpec } from "./window.ts"

export type ScanRange = { start: number; end: number }

export type ScanResult = {
	/** The window body, without the marker. */
	text: string
	total: number
	/** False when the scan stopped before the end and no total was known up front. */
	totalKnown: boolean
	/** Source lines included in `text`, not counting the omitted-lines placeholder. */
	shown: number
	ranges: ScanRange[]
	/** True when the byte cap dropped or truncated output. */
	capped: boolean
	stoppedEarly: boolean
}

export type ScanSource = { kind: "file"; path: string } | { kind: "text"; text: string }

export type ScanOptions = {
	maxBytes: number
	/** Total line count parsed from the built-in marker, when available. */
	hintTotal?: number
	timeoutMs?: number
}

const NOTE = " (line truncated)"

const byteLength = (value: string) => Buffer.byteLength(value, "utf8")

/** The longest start of `line` that fits in `budget` bytes, on a UTF-8 boundary. */
function cutHead(line: string, budget: number): string {
	const buffer = Buffer.from(line, "utf8")
	if (buffer.length <= budget) return line
	let end = Math.max(0, budget)
	while (end > 0 && (buffer[end] & 0xc0) === 0x80) end--
	return buffer.subarray(0, end).toString("utf8")
}

/** The longest end of `line` that fits in `budget` bytes, on a UTF-8 boundary. */
function cutTail(line: string, budget: number): string {
	const buffer = Buffer.from(line, "utf8")
	if (buffer.length <= budget) return line
	let start = buffer.length - Math.max(0, budget)
	while (start < buffer.length && (buffer[start] & 0xc0) === 0x80) start++
	return buffer.subarray(start).toString("utf8")
}

function fitHead(line: string, room: number): string {
	if (room <= 0) return ""
	if (byteLength(line) <= room) return line
	const noteRoom = room - byteLength(NOTE)
	if (noteRoom <= 0) return cutHead(line, room)
	return `${cutHead(line, noteRoom)}${NOTE}`
}

function fitTail(line: string, room: number): string {
	if (room <= 0) return ""
	if (byteLength(line) <= room) return line
	const noteRoom = room - byteLength(NOTE)
	if (noteRoom <= 0) return cutTail(line, room)
	return `${NOTE}${cutTail(line, noteRoom)}`
}

async function* fileLines(path: string, signal: AbortSignal): AsyncGenerator<string> {
	const stream = createReadStream(path, { signal })
	const reader = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY })
	try {
		for await (const line of reader) yield line
	} finally {
		reader.close()
		stream.destroy()
	}
}

function textLines(text: string): string[] {
	if (text === "") return []
	const lines = text.split("\n")
	if (lines[lines.length - 1] === "") lines.pop()
	return lines
}

type Visit = (line: string, index: number) => boolean

/** Visit 1-based lines until the visitor returns false or the source ends. */
async function iterate(source: ScanSource, signal: AbortSignal, visit: Visit): Promise<{ stopped: boolean }> {
	try {
		const lines = source.kind === "file" ? fileLines(source.path, signal) : textLines(source.text)
		let index = 0
		for await (const line of lines) {
			index++
			if (!visit(line, index)) return { stopped: false }
		}
		return { stopped: false }
	} catch (error) {
		if (signal.aborted) return { stopped: true }
		throw error
	}
}

/** Read the size and the first bytes of the output file. */
export async function inspectFile(path: string): Promise<{ size: number; binary: boolean } | undefined> {
	try {
		const info = await stat(path)
		if (!info.isFile()) return undefined
		const handle = await open(path, "r")
		try {
			const buffer = Buffer.alloc(8192)
			const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
			return { size: info.size, binary: buffer.subarray(0, bytesRead).includes(0) }
		} finally {
			await handle.close()
		}
	} catch {
		return undefined
	}
}

export async function scan(source: ScanSource, spec: WindowSpec, options: ScanOptions): Promise<ScanResult> {
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? SCAN_TIMEOUT_MS)
	try {
		switch (spec.kind) {
			case "tail":
				return await scanTail(source, spec.tail, options, controller.signal)
			case "head":
				return await scanHead(source, spec.head, options, controller.signal)
			case "headtail":
				return await scanHeadTail(source, spec.head, spec.tail, options, controller.signal)
			case "range":
				return await scanRange(source, spec.start, spec.end, options, controller.signal)
		}
	} finally {
		clearTimeout(timer)
	}
}

async function scanTail(
	source: ScanSource,
	tail: number,
	options: ScanOptions,
	signal: AbortSignal,
): Promise<ScanResult> {
	const ring: { index: number; line: string }[] = []
	let ringHead = 0
	let ringBytes = 0
	let total = 0
	let capped = false
	const state = await iterate(source, signal, (line, index) => {
		total = index
		ring.push({ index, line })
		ringBytes += byteLength(line) + 1
		if (ring.length - ringHead > tail) {
			ringBytes -= byteLength(ring[ringHead].line) + 1
			ringHead++
		}
		while (ringBytes > options.maxBytes && ring.length - ringHead > 1) {
			ringBytes -= byteLength(ring[ringHead].line) + 1
			ringHead++
			capped = true
		}
		if (ring.length - ringHead === 1 && ringBytes > options.maxBytes) {
			ring[ringHead].line = fitTail(ring[ringHead].line, options.maxBytes - 1)
			ringBytes = byteLength(ring[ringHead].line) + 1
			capped = true
		}
		if (ringHead > 1024) {
			ring.splice(0, ringHead)
			ringHead = 0
		}
		return true
	})
	const kept = ring.slice(ringHead)
	const shown = kept.length
	return {
		text: kept.map((entry) => entry.line).join("\n"),
		total,
		totalKnown: !state.stopped,
		shown,
		ranges: shown === 0 ? [] : [{ start: total - shown + 1, end: total }],
		capped,
		stoppedEarly: state.stopped,
	}
}

async function scanHead(
	source: ScanSource,
	head: number,
	options: ScanOptions,
	signal: AbortSignal,
): Promise<ScanResult> {
	const lines: string[] = []
	let bytes = 0
	let total = 0
	let capped = false
	const hint = options.hintTotal
	const state = await iterate(source, signal, (line, index) => {
		total = index
		if (index <= head && !capped) {
			const separator = lines.length === 0 ? 0 : 1
			if (bytes + separator + byteLength(line) <= options.maxBytes) {
				lines.push(line)
				bytes += separator + byteLength(line)
			} else {
				const room = options.maxBytes - bytes - separator
				if (room > 0) {
					const fitted = fitHead(line, room)
					lines.push(fitted)
					bytes += separator + byteLength(fitted)
				}
				capped = true
			}
		} else if (index <= head) {
			capped = true
		}
		if (hint !== undefined && hint > 0 && index >= Math.min(head, hint)) {
			total = hint
			return false
		}
		return true
	})
	const finalTotal = state.stopped ? (hint ?? total) : total
	return {
		text: lines.join("\n"),
		total: finalTotal,
		totalKnown: state.stopped ? hint !== undefined : true,
		shown: lines.length,
		ranges: lines.length === 0 ? [] : [{ start: 1, end: lines.length }],
		capped,
		stoppedEarly: state.stopped,
	}
}

async function scanRange(
	source: ScanSource,
	start: number,
	end: number | undefined,
	options: ScanOptions,
	signal: AbortSignal,
): Promise<ScanResult> {
	const lines: string[] = []
	let firstShown = 0
	let bytes = 0
	let total = 0
	let capped = false
	const hint = options.hintTotal
	const state = await iterate(source, signal, (line, index) => {
		total = index
		if (index >= start && (end === undefined || index <= end) && !capped) {
			const separator = lines.length === 0 ? 0 : 1
			if (bytes + separator + byteLength(line) <= options.maxBytes) {
				if (lines.length === 0) firstShown = index
				lines.push(line)
				bytes += separator + byteLength(line)
			} else {
				const room = options.maxBytes - bytes - separator
				if (room > 0) {
					if (lines.length === 0) firstShown = index
					const fitted = fitHead(line, room)
					lines.push(fitted)
					bytes += separator + byteLength(fitted)
				}
				capped = true
			}
		}
		if (hint !== undefined && hint > 0) {
			const stopAt = end === undefined ? hint : Math.min(end, hint)
			if (index >= stopAt) {
				total = hint
				return false
			}
		}
		return true
	})
	const finalTotal = state.stopped ? (hint ?? total) : total
	return {
		text: lines.join("\n"),
		total: finalTotal,
		totalKnown: state.stopped ? hint !== undefined : true,
		shown: lines.length,
		ranges: lines.length === 0 ? [] : [{ start: firstShown, end: firstShown + lines.length - 1 }],
		capped,
		stoppedEarly: state.stopped,
	}
}

async function scanHeadTail(
	source: ScanSource,
	head: number,
	tail: number,
	options: ScanOptions,
	signal: AbortSignal,
): Promise<ScanResult> {
	const headLines: string[] = []
	let headBytes = 0
	let headCapped = false
	const ring: { index: number; line: string }[] = []
	let ringHead = 0
	let ringBytes = 0
	let total = 0
	let capped = false
	const state = await iterate(source, signal, (line, index) => {
		total = index
		if (index <= head && !headCapped) {
			const separator = headLines.length === 0 ? 0 : 1
			if (headBytes + separator + byteLength(line) <= options.maxBytes) {
				headLines.push(line)
				headBytes += separator + byteLength(line)
			} else {
				const room = options.maxBytes - headBytes - separator
				if (room > 0) {
					const fitted = fitHead(line, room)
					headLines.push(fitted)
					headBytes += separator + byteLength(fitted)
				}
				headCapped = true
				capped = true
			}
		}
		ring.push({ index, line })
		ringBytes += byteLength(line) + 1
		if (ring.length - ringHead > tail) {
			ringBytes -= byteLength(ring[ringHead].line) + 1
			ringHead++
		}
		while (ringBytes > options.maxBytes && ring.length - ringHead > 1) {
			ringBytes -= byteLength(ring[ringHead].line) + 1
			ringHead++
			capped = true
		}
		if (ring.length - ringHead === 1 && ringBytes > options.maxBytes) {
			ring[ringHead].line = fitTail(ring[ringHead].line, options.maxBytes - 1)
			ringBytes = byteLength(ring[ringHead].line) + 1
			capped = true
		}
		if (ringHead > 1024) {
			ring.splice(0, ringHead)
			ringHead = 0
		}
		return true
	})
	if (state.stopped) {
		return {
			text: headLines.join("\n"),
			total,
			totalKnown: false,
			shown: headLines.length,
			ranges: headLines.length === 0 ? [] : [{ start: 1, end: headLines.length }],
			capped,
			stoppedEarly: true,
		}
	}

	let remaining = options.maxBytes - headBytes
	const tailEntries: { index: number; line: string }[] = []
	for (let index = ring.length - 1; index >= ringHead; index--) {
		const entry = ring[index]
		if (entry.index <= headLines.length) continue
		const separator = tailEntries.length === 0 ? 0 : 1
		if (separator + byteLength(entry.line) <= remaining) {
			tailEntries.unshift(entry)
			remaining -= separator + byteLength(entry.line)
		} else {
			const room = remaining - separator
			if (room > 0) {
				tailEntries.unshift({ index: entry.index, line: fitTail(entry.line, room) })
				remaining = 0
			}
			capped = true
			break
		}
	}

	const shown = headLines.length + tailEntries.length
	const omitted = Math.max(0, total - shown)
	const parts = [...headLines]
	if (omitted > 0 && headLines.length > 0 && tailEntries.length > 0)
		parts.push(`[... ${omitted} lines omitted ...]`)
	parts.push(...tailEntries.map((entry) => entry.line))

	const ranges: ScanRange[] = []
	if (shown > 0) {
		if (headLines.length > 0 && tailEntries.length > 0) {
			if (shown >= total) ranges.push({ start: 1, end: total })
			else
				ranges.push(
					{ start: 1, end: headLines.length },
					{ start: total - tailEntries.length + 1, end: total },
				)
		} else if (headLines.length > 0) ranges.push({ start: 1, end: headLines.length })
		else ranges.push({ start: total - tailEntries.length + 1, end: total })
	}

	return { text: parts.join("\n"), total, totalKnown: true, shown, ranges, capped, stoppedEarly: false }
}
