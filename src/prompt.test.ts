import { describe, expect, it } from "vitest"

import { DEFAULT_READ_BACK_TEXT, injectReadBack, type SystemPartLike } from "./prompt.ts"

const isReadBackPart = (part: SystemPartLike) => part.metadata?.plugin === "command.window"

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
		expect(system.filter(isReadBackPart)).toHaveLength(1)
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
