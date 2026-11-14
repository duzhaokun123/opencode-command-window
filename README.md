# opencode-command-window

> The GitHub repository
> <https://github.com/duzhaokun123/opencode-command-window> is a mirror. The
> canonical repository is
> <https://git.o0kam1.dev/HumanlessCode/opencode-command-window>; code changes and
> pull requests belong there. GitHub issues are welcome for questions and
> discussion.

An OpenCode V2 server plugin that gives the built-in `shell` tool explicit output windows: `tail`, `head`, `lines`, and `max_bytes`.

The default shell tool keeps only the end of large output and saves the rest to a file. Piping a command through `head` or `tail` hides the total line count and the saved path. This plugin lets the model ask for the range it actually needs, after the command has run, without rerunning it.

## Requirements

- OpenCode v2.3.0 or newer.
- Node.js and pnpm to install the plugin from source.

## Install

```sh
git clone https://git.o0kam1.dev/HumanlessCode/opencode-command-window.git \
  ~/.config/opencode/plugins/command-window
cd ~/.config/opencode/plugins/command-window
pnpm install --prod
```

OpenCode loads directories under a config location's `plugins/` folder. If you keep the plugin somewhere else, add its absolute path to `plugins` in `opencode.json(c)`:

```jsonc
{
  "plugins": [{ "package": "/absolute/path/to/command-window" }]
}
```

Reload OpenCode (`/reload`) or restart it. The plugin id is `command.window`.

## Configuration

The read-back prompt is on by default. Change it by declaring the plugin directory in `opencode.json(c)` with an `options` object:

```jsonc
{
  "plugins": [
    {
      "package": "/home/me/.config/opencode/plugins/command-window",
      "options": {
        "readBack": true,
        "readBackText": "Saved shell output is in the reported file; read it instead of rerunning the command."
      }
    }
  ]
}
```

| Option | Type | Meaning |
| --- | --- | --- |
| `readBack` | boolean | Inject the read-back paragraph into the system prompt. Defaults to `true`. |
| `readBackText` | non-empty string | Replace the built-in English paragraph. |

Notes:

- A plugin discovered under a config location's `plugins/` folder receives empty options. Declaring the same absolute directory in `plugins` supplies options; the configured entry is applied last and replaces the discovered one.
- The paragraph is only injected when the `read` tool is available to the request, and only into primary agent requests.
- Invalid values fall back to their defaults and log a `[command.window]` warning.
- The paragraph tells the model to continue reading a saved output file with `read` (`offset`/`limit`, at most 2000 lines per call) instead of rerunning the command. Reading a file outside the workspace can ask for directory approval.
- The paragraph adds a fixed amount of input tokens to every primary request.

## Usage

Call `shell` as usual and add one window parameter:

```jsonc
{ "command": "pytest -q", "tail": 40 }
{ "command": "npm test", "head": 20, "tail": 20 }
{ "command": "cat huge.log", "lines": { "start": 120000, "end": 120050 } }
{ "command": "tar -tf archive.tar", "lines": { "start": 5000 } }
{ "command": "cargo build", "tail": 200, "max_bytes": 1048576 }
```

| Field | Type | Meaning |
| --- | --- | --- |
| `tail` | integer ≥ 0 | Return the last N lines. |
| `head` | integer ≥ 0 | Return the first N lines. |
| `lines` | `{ start, end? }` | Return the 1-based inclusive range. Omit `end` to read to the end. |
| `max_bytes` | integer 1–5242880 | Hard cap on the UTF-8 bytes of the window body. Defaults to 204800. |

Rules:

- `tail` and `head` may be combined to return both ends. The body then contains a `[... N lines omitted ...]` placeholder.
- `lines` cannot be combined with `tail` or `head`.
- `tail: 0` and `head: 0` mean "not set".
- `max_bytes` alone does not open a window.
- Without any window parameter the result is left exactly as OpenCode produced it.

## What comes back

The body is followed by one marker paragraph:

```text
[showing lines 199998-200000 of 200000 (tail 3); full output saved to /home/me/.local/share/opencode/shell/0123456789abcdef/sh_abc.out]
```

```text
[showing lines 1-5 and 119996-120000 of 120000 (head 5, tail 5); full output saved to /home/me/.local/share/opencode/shell/0123456789abcdef/sh_abc.out]
```

```text
[showing lines 120000-120050 of 120051 (lines 120000-120050); full output saved to /home/me/.local/share/opencode/shell/0123456789abcdef/sh_abc.out]
```

```text
[showing lines 1-2 of 3 (head 2); full output was not saved because the result was not truncated]
```

The total line count is always reported. When OpenCode saved the complete output, the marker contains the file path, so a later read can return another range without rerunning the command: use the `read` tool on that path with `offset` and `limit`, or call `shell` again with `lines` when the command is cheap. When the output was complete inline, no file exists and the marker says so instead of inventing a path.

Marker notes:

- `capped at N bytes`: the byte cap stopped the window before it was complete.
- `scan stopped after 5000 ms`: the five-second scan budget ran out; the total is reported as `at least N`.
- `max_bytes clamped to 5242880`: the requested cap was above the maximum.
- `no lines in the requested range; total N`: the range starts past the end.
- `(no output)`: the command produced no output.

## Behavior details

- OpenCode's saved output file is the preferred source. Complete inline output is scanned directly.
- If only a truncated preview is available because the saved file is gone, the plugin leaves the preview untouched and prepends `[window not applied: ...]`.
- Binary output is replaced with a byte-count description instead of being decoded.
- Background results that are still running, and killed results, are never windowed.
- Exit-code and timeout notices are content parts, not the body; they are preserved.
- Memory use is bounded by `max_bytes`; the scan never buffers the whole output. The scan budget is five seconds.
- The command is never rerun, rewritten, or filtered through another process.
- Windowed results set `metadata.truncated` and add `metadata.window` with `mode`, `shownLines`, `totalLines`, `maxBytes`, and `clamped`.

## Limitations

- No `grep`, regex, or context filters. Filter with the command itself when you need matching lines.
- Ranges are line-based. `max_bytes` only caps the result; it cannot address a byte range.
- The plugin does not clean up OpenCode's saved output files.
- A window cannot recover output that OpenCode already discarded before saving a file.

## Uninstall

Remove the plugin directory (or its `plugins` entry) and reload OpenCode.

## Development

```sh
pnpm install
pnpm check   # tsc --noEmit && vitest run
```

| Path | Purpose |
| --- | --- |
| `src/index.ts` | Plugin wiring: options, schema and description transforms, system prompt injection, `execute.after` hook. |
| `src/options.ts` | Plugin option validation and defaults. |
| `src/prompt.ts` | Read-back paragraph and idempotent system part injection. |
| `src/schema.ts` | Replacement `shell` input schema and the appended description. |
| `src/window.ts` | Parameter parsing and marker rendering. |
| `src/scan.ts` | Streaming file and text scans with byte caps. |
| `src/apply.ts` | Applies a window to one completed tool result. |

### Manual verification

1. Install the plugin and reload OpenCode.
2. Run `seq 1 200000` with `{"tail": 3}`. The marker must report lines 199998–200000 of 200000 and the saved path.
3. Run the same command with `{"head": 3, "tail": 3}`. The body must contain one omitted-lines placeholder.
4. Run it with `{"lines": {"start": 100000, "end": 100003}}`. Exactly four lines must come back.
5. Run `seq 1 5` with `{"tail": 2}`. The marker must say the result was not truncated.
6. Combine `lines` with `tail`. The result must start with `[window error: ...]` and keep the default preview.
7. Start `sleep 5` with `{"background": true, "tail": 1}`. The running result must be untouched.
8. Run `seq 1 200000` with `{"tail": 3}` and then ask the model to show another range. It must read the reported file with the `read` tool instead of rerunning the command.
9. Check `~/.local/share/opencode/log/opencode.log` for `[command.window]` warnings.
