import { describe, expect, it, vi } from "vitest"

import { DEFAULT_OPTIONS, resolveOptions } from "./options.ts"
import { DEFAULT_READ_BACK_TEXT, DEFAULT_WINDOW_HINT_TEXT } from "./prompt.ts"

function captureWarnings() {
	const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
	return {
		warn,
		messages: () => warn.mock.calls.map((call) => String(call[0])),
		restore: () => warn.mockRestore(),
	}
}

describe("resolveOptions", () => {
	it("uses the defaults when no options are configured", () => {
		expect(resolveOptions(undefined)).toEqual(DEFAULT_OPTIONS)
		expect(resolveOptions({})).toEqual(DEFAULT_OPTIONS)
		expect(DEFAULT_OPTIONS.pipeWindow).toBe(false)
		expect(DEFAULT_OPTIONS.readBack).toBe(true)
		expect(DEFAULT_OPTIONS.readBackText).toBe(DEFAULT_READ_BACK_TEXT)
		expect(DEFAULT_OPTIONS.windowHint).toBe(true)
		expect(DEFAULT_OPTIONS.windowHintText).toBe(DEFAULT_WINDOW_HINT_TEXT)
	})

	it("enables the pipe rewrite", () => {
		expect(resolveOptions({ pipeWindow: true })).toEqual({
			pipeWindow: true,
			readBack: true,
			readBackText: DEFAULT_READ_BACK_TEXT,
			windowHint: true,
			windowHintText: DEFAULT_WINDOW_HINT_TEXT,
		})
	})

	it("disables the read-back prompt", () => {
		expect(resolveOptions({ readBack: false })).toEqual({
			pipeWindow: false,
			readBack: false,
			readBackText: DEFAULT_READ_BACK_TEXT,
			windowHint: true,
			windowHintText: DEFAULT_WINDOW_HINT_TEXT,
		})
	})

	it("disables the window hint", () => {
		expect(resolveOptions({ windowHint: false })).toEqual({
			pipeWindow: false,
			readBack: true,
			readBackText: DEFAULT_READ_BACK_TEXT,
			windowHint: false,
			windowHintText: DEFAULT_WINDOW_HINT_TEXT,
		})
	})

	it("replaces the default texts", () => {
		expect(resolveOptions({ readBackText: "Custom instruction." })).toEqual({
			pipeWindow: false,
			readBack: true,
			readBackText: "Custom instruction.",
			windowHint: true,
			windowHintText: DEFAULT_WINDOW_HINT_TEXT,
		})
		expect(resolveOptions({ windowHintText: "Use window parameters." })).toEqual({
			pipeWindow: false,
			readBack: true,
			readBackText: DEFAULT_READ_BACK_TEXT,
			windowHint: true,
			windowHintText: "Use window parameters.",
		})
	})

	it("ignores unknown keys", () => {
		expect(resolveOptions({ readBack: false, unknown: 1 })).toEqual({
			pipeWindow: false,
			readBack: false,
			readBackText: DEFAULT_READ_BACK_TEXT,
			windowHint: true,
			windowHintText: DEFAULT_WINDOW_HINT_TEXT,
		})
	})

	it("falls back to defaults for invalid values and warns", () => {
		const capture = captureWarnings()
		try {
			expect(resolveOptions({ readBack: "no", readBackText: 42 })).toEqual(DEFAULT_OPTIONS)
			expect(resolveOptions({ readBackText: "   " })).toEqual(DEFAULT_OPTIONS)
			expect(resolveOptions({ readBack: null })).toEqual(DEFAULT_OPTIONS)
			expect(resolveOptions({ pipeWindow: "no" })).toEqual(DEFAULT_OPTIONS)
			expect(resolveOptions({ pipeWindow: null })).toEqual(DEFAULT_OPTIONS)
			expect(resolveOptions({ windowHint: "no", windowHintText: 42 })).toEqual(DEFAULT_OPTIONS)
			expect(resolveOptions({ windowHintText: "   " })).toEqual(DEFAULT_OPTIONS)
			expect(resolveOptions({ windowHint: null })).toEqual(DEFAULT_OPTIONS)
			expect(capture.messages().filter((message) => message.includes("readBack must be a boolean"))).toHaveLength(2)
			expect(capture.messages().filter((message) => message.includes("readBackText must be"))).toHaveLength(2)
			expect(capture.messages().filter((message) => message.includes("pipeWindow must be a boolean"))).toHaveLength(2)
			expect(capture.messages().filter((message) => message.includes("windowHint must be a boolean"))).toHaveLength(2)
			expect(capture.messages().filter((message) => message.includes("windowHintText must be"))).toHaveLength(2)
		} finally {
			capture.restore()
		}
	})

	it("never throws for non-object options", () => {
		const capture = captureWarnings()
		try {
			for (const value of [null, [], "x", 1, true]) {
				expect(resolveOptions(value)).toEqual(DEFAULT_OPTIONS)
			}
			expect(capture.messages()).toHaveLength(5)
		} finally {
			capture.restore()
		}
	})
})
