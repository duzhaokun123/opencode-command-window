const SHELL = "shell"

export type ParsedPipe =
	| { ok: true; command: string; head?: number; tail?: number }
	| { ok: false }

/** The subset of the `execute.before` event this plugin reads and edits. */
export type BeforeEventLike = {
	readonly tool: string
	input: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Positive integer as a bare token; `0` is rejected because the window treats it as "no window". */
function countAt(token: string | undefined): number | undefined {
	if (token === undefined || !/^\d+$/.test(token) || token === "0") return undefined
	return Number(token)
}

/**
 * Offset of the last pipe operator at shell quoting depth 0, skipping `||` and `|&`
 * (those are list operators, not stream pipes). Undefined when the command has none.
 */
function lastPipe(command: string): number | undefined {
	let single = false
	let double = false
	let last: number | undefined
	for (let i = 0; i < command.length; i++) {
		const ch = command[i]
		if (single) {
			if (ch === "'") single = false
			continue
		}
		if (double) {
			if (ch === "\\") i++
			else if (ch === '"') double = false
			continue
		}
		if (ch === "\\") i++
		else if (ch === "'") single = true
		else if (ch === '"') double = true
		else if (
			ch === "|" &&
			command[i - 1] !== "|" &&
			command[i - 1] !== "&" &&
			command[i + 1] !== "|" &&
			command[i + 1] !== "&"
		)
			last = i
	}
	return last
}

/**
 * Whether the command joins another command to itself at shell quoting depth 0. A trailing
 * `| head`/`| tail` only sees the last pipeline of such a command (`a && b | tail -n 3`
 * tails `b`, not `a`), while the window parameters would cover the output of every part, so
 * commands with a join are left alone. `&&`, `||`, `;`, `&`, and a newline are joins;
 * `>&` (descriptor duplication such as `2>&1`) and a newline right after `|` (a line break
 * inside the pipeline) are not.
 */
function hasJoin(command: string): boolean {
	let single = false
	let double = false
	for (let i = 0; i < command.length; i++) {
		const ch = command[i]
		if (single) {
			if (ch === "'") single = false
			continue
		}
		if (double) {
			if (ch === "\\") i++
			else if (ch === '"') double = false
			continue
		}
		if (ch === "\\") i++
		else if (ch === "'") single = true
		else if (ch === '"') double = true
		else if (ch === "&") {
			if (command[i - 1] !== ">") return true
		} else if (ch === ";") return true
		else if (ch === "|" && command[i + 1] === "|") return true
		else if (ch === "\n") {
			let j = i - 1
			while (j >= 0 && (command[j] === " " || command[j] === "\t")) j--
			if (command[j] !== "|") return true
		}
	}
	return false
}

/**
 * Parse one `head`/`tail` invocation into a line count. Anything the plugin does not
 * fully understand — other flags (`-c`, `-v`, …), extra arguments, quoting or command
 * substitution, a missing or zero count, a negative offset like `-n +5` — returns
 * undefined, which means "leave the command alone".
 */
function parseSegment(segment: string): { head?: number; tail?: number } | undefined {
	if (/['"\\$`]/.test(segment)) return undefined
	const tokens = segment.trim().split(/\s+/)
	const word = tokens.shift()
	if (word !== "head" && word !== "tail") return undefined

	let count: number | undefined
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i]
		if (token === "-n" || token === "--lines") {
			count = countAt(tokens[++i])
			if (count === undefined) return undefined
			continue
		}
		if (token.startsWith("--lines=")) {
			count = countAt(token.slice("--lines=".length))
			if (count === undefined) return undefined
			continue
		}
		if (token.startsWith("-n") && token.length > 2) {
			count = countAt(token.slice(2))
			if (count === undefined) return undefined
			continue
		}
		if (token.startsWith("-")) {
			count = countAt(token.slice(1))
			if (count === undefined) return undefined
			continue
		}
		return undefined
	}
	if (count === undefined) return undefined
	return word === "head" ? { head: count } : { tail: count }
}

/**
 * Parse a trailing `| head`/`| tail` pipe off the end of one single command. Commands that
 * join other commands are left alone, as is a command whose remaining text would end in a
 * dangling backslash. Only one segment is stripped, and only when what remains does not
 * itself end in another `head`/`tail` pipe: `cmd | head -N | tail -M` selects a middle
 * range, which the head+tail window parameters cannot express, so chains are left untouched.
 */
export function parsePipeWindow(command: string): ParsedPipe {
	let text = command.trimEnd()
	if (text.endsWith(";")) text = text.slice(0, -1).trimEnd()
	if (hasJoin(text)) return { ok: false }
	const pipe = lastPipe(text)
	if (pipe === undefined) return { ok: false }
	const left = text.slice(0, pipe).trim()
	if ((left.length - left.replace(/\\+$/, "").length) % 2 === 1) return { ok: false }
	const parsed = parseSegment(text.slice(pipe + 1))
	if (parsed === undefined) return { ok: false }
	const leftPipe = lastPipe(left)
	if (leftPipe !== undefined && parseSegment(left.slice(leftPipe + 1)) !== undefined) return { ok: false }
	return { ok: true, command: left, ...parsed }
}

/**
 * Rewrite one shell call in place before execution: a trailing `| head`/`| tail` pipe is
 * removed from the command and replaced with the equivalent window parameters, so the
 * command runs at full width and the plugin's execute.after hook windows the result.
 * Calls the plugin cannot rewrite — including ones that already carry window parameters —
 * are left exactly as they were.
 */
export function rewritePipeWindow(event: BeforeEventLike): void {
	if (event.tool !== SHELL) return
	const input = event.input
	if (!isRecord(input) || typeof input.command !== "string") return
	if (input.head !== undefined || input.tail !== undefined || input.lines !== undefined) return
	const parsed = parsePipeWindow(input.command)
	if (!parsed.ok) return
	if (parsed.head !== undefined) input.head = parsed.head
	if (parsed.tail !== undefined) input.tail = parsed.tail
	input.command = parsed.command
}
