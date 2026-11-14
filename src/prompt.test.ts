import { describe, expect, it } from "vitest"

import {
	DEFAULT_READ_BACK_TEXT,
	DEFAULT_WINDOW_HINT_TEXT,
	injectReadBack,
	injectWindowHint,
	type SystemPartLike,
} from "./prompt.ts"

const isHintPart = (kind: string) => (part: SystemPartLike) =>
	part.metadata?.plugin === "command.window" && part.metadata?.kind === kind

describe("injectWindowHint", () => {
	it("appends one tagged part without touching existing parts", () => {
		const existing: SystemPartLike = { type: "text", text: "base prompt" }
		const system: SystemPartLike[] = [existing]

		expect(injectWindowHint(system, DEFAULT_WINDOW_HINT_TEXT)).toBe(true)
		expect(system).toHaveLength(2)
		expect(system[0]).toBe(existing)
		expect(system[1]).toMatchObject({
			type: "text",
			text: DEFAULT_WINDOW_HINT_TEXT,
			metadata: { plugin: "command.window", kind: "window-hint" },
		})
	})

	it("is idempotent across repeated hook runs", () => {
		const system: SystemPartLike[] = []

		expect(injectWindowHint(system, DEFAULT_WINDOW_HINT_TEXT)).toBe(true)
		expect(injectWindowHint(system, DEFAULT_WINDOW_HINT_TEXT)).toBe(false)
		expect(injectWindowHint(system, "another text")).toBe(false)
		expect(system).toHaveLength(1)
		expect(system.filter(isHintPart("window-hint"))).toHaveLength(1)
	})

	it("writes a custom text verbatim", () => {
		const system: SystemPartLike[] = []

		expect(injectWindowHint(system, "Use window parameters.")).toBe(true)
		expect(system[0]?.text).toBe("Use window parameters.")
	})

	it("does not block or duplicate the read-back part", () => {
		const system: SystemPartLike[] = []

		expect(injectWindowHint(system, DEFAULT_WINDOW_HINT_TEXT)).toBe(true)
		expect(injectReadBack(system, DEFAULT_READ_BACK_TEXT)).toBe(true)
		expect(system).toHaveLength(2)
		expect(system.filter(isHintPart("window-hint"))).toHaveLength(1)
		expect(system.filter(isHintPart("read-back"))).toHaveLength(1)
	})

	it("ignores unrelated metadata when looking for its own part", () => {
		const system: SystemPartLike[] = [
			{ type: "text", text: "other", metadata: { plugin: "other", kind: "window-hint" } },
			{ type: "text", text: "other", metadata: { plugin: "command.window", kind: "other" } },
		]

		expect(injectWindowHint(system, DEFAULT_WINDOW_HINT_TEXT)).toBe(true)
		expect(system).toHaveLength(3)
	})
})

describe("injectReadBack", () => {
	it("appends one tagged part without touching existing parts", () => {
		const existing: SystemPartLike = { type: "text", text: "base prompt" }
		const system: SystemPartLike[] = [existing]

		expect(injectReadBack(system, DEFAULT_READ_BACK_TEXT)).toBe(true)
		expect(system).toHaveLength(2)
		expect(system[0]).toBe(existing)
		expect(system[1]).toMatchObject({
			type: "text",
			text: DEFAULT_READ_BACK_TEXT,
			metadata: { plugin: "command.window", kind: "read-back" },
		})
	})

	it("is idempotent across repeated hook runs", () => {
		const system: SystemPartLike[] = []

		expect(injectReadBack(system, DEFAULT_READ_BACK_TEXT)).toBe(true)
		expect(injectReadBack(system, DEFAULT_READ_BACK_TEXT)).toBe(false)
		expect(injectReadBack(system, "another text")).toBe(false)
		expect(system).toHaveLength(1)
		expect(system.filter(isHintPart("read-back"))).toHaveLength(1)
	})

	it("writes a custom text verbatim", () => {
		const system: SystemPartLike[] = []

		expect(injectReadBack(system, "Use read please.")).toBe(true)
		expect(system[0]?.text).toBe("Use read please.")
	})

	it("ignores unrelated metadata when looking for its own part", () => {
		const system: SystemPartLike[] = [
			{ type: "text", text: "other", metadata: { plugin: "other", kind: "read-back" } },
			{ type: "text", text: "other", metadata: { plugin: "command.window", kind: "other" } },
		]

		expect(injectReadBack(system, DEFAULT_READ_BACK_TEXT)).toBe(true)
		expect(system).toHaveLength(3)
	})
})
