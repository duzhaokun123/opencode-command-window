import { describe, expect, it } from "vitest"

import { DESCRIPTION_MARKER, INPUT_SCHEMA, OUTPUT_WINDOW_DESCRIPTION } from "./schema.ts"

describe("INPUT_SCHEMA", () => {
	it("keeps the built-in shell fields required", () => {
		expect(INPUT_SCHEMA).toMatchObject({
			type: "object",
			required: ["command"],
			additionalProperties: false,
		})
		const properties = INPUT_SCHEMA.properties as Record<string, unknown>
		expect(Object.keys(properties)).toEqual([
			"command",
			"workdir",
			"timeout",
			"background",
			"tail",
			"head",
			"lines",
			"max_bytes",
		])
	})

	it("validates the window fields without a hard byte maximum", () => {
		const properties = INPUT_SCHEMA.properties as Record<string, { minimum?: number; maximum?: number }>
		expect(properties.tail.minimum).toBe(0)
		expect(properties.head.minimum).toBe(0)
		expect(properties.max_bytes.minimum).toBe(1)
		expect(properties.max_bytes.maximum).toBeUndefined()
	})
})

describe("description", () => {
	it("uses the marker the runtime checks for", () => {
		expect(OUTPUT_WINDOW_DESCRIPTION.startsWith(DESCRIPTION_MARKER)).toBe(true)
	})

	it("does not advertise unsupported filters", () => {
		expect(OUTPUT_WINDOW_DESCRIPTION).not.toContain("grep")
		expect(OUTPUT_WINDOW_DESCRIPTION).not.toContain("context")
	})
})
