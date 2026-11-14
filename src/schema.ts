/**
 * The JSON Schema replaces the built-in `shell` input while the plugin is
 * loaded. The four base fields keep the descriptions shipped by OpenCode
 * v2.3.0 (`Input = input(false)`), so replacing the schema does not change
 * their meaning for the model.
 */
export const INPUT_SCHEMA: Record<string, unknown> = {
	type: "object",
	properties: {
		command: {
			type: "string",
			description: "Shell command string to execute",
		},
		workdir: {
			type: "string",
			description:
				"Working directory to execute the command in. Defaults to the current working directory. When possible, avoid changing directories in the command and set the working directory here instead.",
		},
		timeout: {
			type: "integer",
			minimum: 0,
			description:
				"Timeout in milliseconds. Set to 0 to disable the timeout. Defaults to 120000 for foreground commands. Background commands have no timeout by default.",
		},
		background: {
			type: "boolean",
			description:
				"Run the command in the background and return immediately (useful for dev servers and long-running builds). You do not need to use '&' at the end of the command when using this parameter. You will be notified when it completes. DO NOT poll for completion.",
		},
		tail: {
			type: "integer",
			minimum: 0,
			description:
				"Return only the last N lines of the output instead of the default preview. Combine with head to return both the start and the end.",
		},
		head: {
			type: "integer",
			minimum: 0,
			description:
				"Return only the first N lines of the output instead of the default preview. Combine with tail to return both the start and the end.",
		},
		lines: {
			type: "object",
			properties: {
				start: { type: "integer", minimum: 1 },
				end: { type: "integer", minimum: 1 },
			},
			required: ["start"],
			additionalProperties: false,
			description:
				"Return an exact 1-based inclusive line range. Omit end to read to the end of the output.",
		},
		max_bytes: {
			type: "integer",
			minimum: 1,
			description:
				"Hard cap on the UTF-8 bytes of the window body for this call. Defaults to 204800, maximum 5242880. Raise it only when you really need a larger window.",
		},
	},
	required: ["command"],
	additionalProperties: false,
}

/** Marker used to detect the paragraph appended to the live shell description. */
export const DESCRIPTION_MARKER = "Output window:"

export const OUTPUT_WINDOW_DESCRIPTION =
	"Output window: when the result is large, OpenCode keeps only the last lines and saves the full output to a file. To choose a different range yourself, pass tail, head, or lines instead of piping the command through head or tail. tail and head may be combined to return the start and the end. max_bytes caps the returned bytes. Every windowed result reports the total line count and, when OpenCode saved the full output, the file path, so a later call can read another range from that file without rerunning the command."
