# opencode-command-window

一个 OpenCode V2 服务端插件，为内置 `shell` 工具补上显式输出窗口：`tail`、`head`、`lines`、`max_bytes`。

OpenCode 默认只保留大段输出的末尾，并把完整输出保存到文件。如果命令自己接 `head`/`tail`，返回里就看不到总行数和保存路径。这个插件让模型在命令执行完之后，直接指定真正需要的那一段，而不必重跑命令。

## 环境要求

- OpenCode v2.3.0 或更新版本。
- 从源码安装需要 Node.js 与 pnpm。

## 安装

```sh
git clone https://git.o0kam1.dev/HumanlessCode/opencode-command-window.git \
  ~/.config/opencode/plugins/command-window
cd ~/.config/opencode/plugins/command-window
pnpm install --prod
```

OpenCode 会加载配置目录下 `plugins/` 中的插件目录。如果插件放在别处，请把绝对路径写进 `opencode.json(c)` 的 `plugins`：

```jsonc
{
  "plugins": [{ "package": "/absolute/path/to/command-window" }]
}
```

执行 `/reload` 或重启 OpenCode。插件 id 为 `command.window`。

## 用法

照常调用 `shell`，附加一个窗口参数：

```jsonc
{ "command": "pytest -q", "tail": 40 }
{ "command": "npm test", "head": 20, "tail": 20 }
{ "command": "cat huge.log", "lines": { "start": 120000, "end": 120050 } }
{ "command": "tar -tf archive.tar", "lines": { "start": 5000 } }
{ "command": "cargo build", "tail": 200, "max_bytes": 1048576 }
```

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `tail` | 整数 ≥ 0 | 返回最后 N 行。 |
| `head` | 整数 ≥ 0 | 返回最前 N 行。 |
| `lines` | `{ start, end? }` | 返回 1 起始、包含两端的行区间。省略 `end` 表示读到末尾。 |
| `max_bytes` | 整数 1–5242880 | 窗口正文的 UTF-8 字节硬上限，默认 204800。 |

规则：

- `tail` 与 `head` 可以同时使用，正文中间会出现 `[... N lines omitted ...]` 占位行。
- `lines` 不能与 `tail` 或 `head` 组合。
- `tail: 0`、`head: 0` 等同于没有设置。
- 只给 `max_bytes` 不会开启窗口。
- 不传任何窗口参数时，结果与安装前的 OpenCode 完全一致。

## 返回内容

正文之后会附加一段 marker：

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

marker 总会报告总行数。如果 OpenCode 保存了完整输出，marker 会带上文件路径，后续可以用 `lines` 从该文件读取另一段，无需重跑命令。如果输出本来就完整地留在上下文里，就不存在文件，marker 会明确说明，而不会编造路径。

marker 备注：

- `capped at N bytes`：窗口在完成前触达字节上限。
- `scan stopped after 5000 ms`：五秒扫描预算耗尽；总行数报告为 `at least N`。
- `max_bytes clamped to 5242880`：请求的上限超过最大值。
- `no lines in the requested range; total N`：区间起点超过末尾。
- `(no output)`：命令没有输出。

## 行为细节

- 优先读取 OpenCode 保存的输出文件；输出本来就完整时直接扫描内联文本。
- 如果只剩截断预览、且保存文件已经不存在，插件保持预览不变，并在最前面加一行 `[window not applied: ...]`。
- 二进制输出替换为字节数说明，不做解码。
- 仍在运行的后台结果以及被 kill 的结果不会被窗口化。
- 退出码、超时提示属于独立的内容 part，会被保留。
- 内存占用以 `max_bytes` 为上界，扫描过程不会缓冲完整输出；扫描预算为五秒。
- 不会重跑命令、改写命令或把命令接到另一个过滤进程。
- 被窗口化的结果会设置 `metadata.truncated`，并添加 `metadata.window`，包含 `mode`、`shownLines`、`totalLines`、`maxBytes`、`clamped`。

## 限制

- 不提供 `grep`、正则或上下文过滤。需要匹配行时请让命令自身完成过滤。
- 区间按行计算。`max_bytes` 只限制返回大小，不能用于寻址字节区间。
- 插件不清理 OpenCode 保存的输出文件。
- 如果 OpenCode 在保存文件之前就已经丢弃了输出，窗口无法把这部分找回来。

## 卸载

删除插件目录（或 `plugins` 中的对应条目），然后重新加载 OpenCode。

## 开发

```sh
pnpm install
pnpm check   # tsc --noEmit && vitest run
```

| 路径 | 作用 |
| --- | --- |
| `src/index.ts` | 插件接线：schema 与描述变换、`execute.after` hook。 |
| `src/schema.ts` | 替换后的 `shell` input schema 与追加描述。 |
| `src/window.ts` | 参数解析与 marker 渲染。 |
| `src/scan.ts` | 带字节上限的流式文件/文本扫描。 |
| `src/apply.ts` | 把窗口应用到单个已完成的工具结果。 |

### 手动验证

1. 安装插件并重新加载 OpenCode。
2. 用 `{"tail": 3}` 执行 `seq 1 200000`。marker 必须报告 199998–200000 行（共 200000 行）以及保存路径。
3. 用 `{"head": 3, "tail": 3}` 执行同一命令。正文中间必须出现一个 omitted-lines 占位行。
4. 用 `{"lines": {"start": 100000, "end": 100003}}` 执行同一命令。必须只返回四行。
5. 用 `{"tail": 2}` 执行 `seq 1 5`。marker 必须说明结果未被截断。
6. 把 `lines` 与 `tail` 组合。结果必须以 `[window error: ...]` 开头，并保留默认预览。
7. 用 `{"background": true, "tail": 1}` 启动 `sleep 5`。运行中的结果必须保持不变。
8. 检查 `~/.local/share/opencode/log/opencode.log` 是否有 `[command.window]` 警告。
