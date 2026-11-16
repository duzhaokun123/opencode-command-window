# opencode-command-window

> GitHub 仓库 <https://github.com/duzhaokun123/opencode-command-window> 是镜像仓库。
> 规范仓库为 <https://git.o0kam1.dev/HumanlessCode/opencode-command-window>，代码改动与
> pull request 请提交到规范仓库；GitHub 的 issue 可用于提问与讨论。

一个非官方的 OpenCode V2 服务端插件，为内置 `shell` 工具补上显式输出窗口：`tail`、`head`、`lines`、`max_bytes`。

OpenCode 默认只保留大段输出的末尾，并把完整输出保存到文件。如果命令自己接 `head`/`tail`，返回里就看不到总行数和保存路径。这个插件让模型在命令执行完之后，直接指定真正需要的那一段，而不必重跑命令；默认还会提示模型用这些参数限制输出，而不是把命令接到 `head`/`tail`。

## 环境要求

- OpenCode v2.3.0 或更新版本。
- 只有从源码安装时才需要 Node.js 与 pnpm。

## 安装

用 OpenCode CLI 安装：

```sh
opencode plugin add @o0kam1/opencode-command-window
```

或者把它写进 `opencode.json(c)` 的 `plugins`：

```jsonc
{
  "plugins": ["@o0kam1/opencode-command-window"]
}
```

执行 `/reload` 或重启 OpenCode。插件 id 是 `command.window`，与包名不同：禁用或配置插件时要用这个 id。

如果要使用尚未发布的代码，把仓库克隆到全局插件目录并安装依赖：

```sh
git clone https://git.o0kam1.dev/HumanlessCode/opencode-command-window.git \
  ~/.config/opencode/plugins/command-window
cd ~/.config/opencode/plugins/command-window
pnpm install --prod
```

OpenCode 会加载配置目录下 `plugins/` 中的插件目录。如果克隆放在别处，请把它的绝对路径写进 `opencode.json(c)` 的 `plugins`：

```jsonc
{
  "plugins": [{ "package": "/absolute/path/to/command-window" }]
}
```

## 配置

两段系统提示词默认都开启。要修改，请在 `opencode.json(c)` 中声明插件并附上 `options`：

```jsonc
{
  "plugins": [
    {
      "package": "@o0kam1/opencode-command-window",
      "options": {
        "pipeWindow": true,
        "windowHint": true,
        "windowHintText": "用 shell 的输出窗口参数限制输出，不要把命令接到 head 或 tail。",
        "readBack": true,
        "readBackText": "完整输出在报告的文件里，请读取该文件而不是重跑命令。"
      }
    }
  ]
}
```

| 选项 | 类型 | 含义 |
| --- | --- | --- |
| `pipeWindow` | 布尔 | 把命令结尾的 `\| head` / `\| tail` 管道改写成 `head` / `tail` 窗口参数再执行，默认 `false`。 |
| `windowHint` | 布尔 | 是否把截断参数段落注入系统提示词，默认 `true`。 |
| `windowHintText` | 非空字符串 | 替换内置的截断参数段落。 |
| `readBack` | 布尔 | 是否把回读段落注入系统提示词，默认 `true`。 |
| `readBackText` | 非空字符串 | 替换内置的回读段落。 |

说明：

- 选项只来自 `plugins` 条目。通过配置目录 `plugins/` 自动发现的插件拿到的是空选项；在 `plugins` 中声明同一个包或同一个绝对目录即可提供选项，并替换自动发现的那一条。
- `pipeWindow` 默认关闭，因为它会在命令执行前改写命令。开启后，命令结尾带显式行数的 `\| head` / `\| tail`（`-n N`、`-NN`、`--lines=N`、`--lines N`）会被改写成全量执行，行数移入 `head` / `tail` 参数，因此 marker 会报告总行数与保存路径。只改写最后一个管道段：head→tail 链、不带行数的裸 `head` / `tail`、字节模式（`-c`）、其他 flag、多余参数、引号或命令替换、已带窗口参数的调用都保持原样；用 `&&`、`||`、`;`、`&` 或换行拼接了其他命令的调用也保持原样，因为管道只作用于最后一段，而窗口参数会覆盖整条命令的输出。
- 两段提示都只注入主 Agent 请求。截断参数段落还要求该请求包含 `shell` 工具；回读段落要求 `read` 工具。
- 无效值会回退默认值，并在日志中留下 `[command.window]` 警告。
- 截断参数段落要求模型传 `tail`、`head`、`lines` 或 `max_bytes`，而不是把命令接到 `| head` / `| tail`：管道会隐藏总行数与保存路径，还可能提前终止命令。`grep` 等内容过滤仍由命令自身完成。
- 回读段落要求模型用 `read`（`offset`/`limit`，单次最多 2000 行）继续读取保存的输出文件，而不是重跑命令。读取工作区外的文件可能触发目录授权确认。
- 每段提示都会给每次主请求增加固定数量的输入 token。

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

要限制返回量，请传这些参数，不要把命令接到 `| head` 或 `| tail`：管道会隐藏总行数与保存路径，还可能提前终止命令。按内容过滤（例如 `grep`）仍由命令自身完成。开启 `pipeWindow` 后，命令结尾带显式行数的 `\| head` / `\| tail` 管道会在执行前被改写成这些参数。

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

marker 总会报告总行数。如果 OpenCode 保存了完整输出，marker 会带上文件路径，后续无需重跑命令即可读取另一段：用 `read` 工具读取该路径并指定 `offset` 与 `limit`；如果命令本身很便宜，也可以用 `lines` 再次调用 `shell`。如果输出本来就完整地留在上下文里，就不存在文件，marker 会明确说明，而不会编造路径。

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
- 截断参数不会显示在界面上。插件不提供 TUI 或 GUI 部分，因为 OpenCode v2.3.0 没有工具调用行的渲染器，任何客户端都无法在调用旁边标注模型选择的参数。参数只出现在返回文本末尾的 marker 里，以及工具结果的 `metadata.window` 中；输出被折叠时，用户必须展开才能看到。

## 卸载

```sh
opencode plugin remove @o0kam1/opencode-command-window
```

如果是源码安装，请删除对应目录（或 `plugins` 中的对应条目），然后重新加载 OpenCode。

## 开发

```sh
pnpm install
pnpm check   # tsc --noEmit && vitest run
```

| 路径 | 作用 |
| --- | --- |
| `src/index.ts` | 插件接线：选项、schema 与描述变换、系统提示词注入、`execute.before` 与 `execute.after` hook。 |
| `src/options.ts` | 插件选项校验与默认值。 |
| `src/prompt.ts` | 截断参数段落、回读段落，以及幂等的 system part 注入。 |
| `src/schema.ts` | 替换后的 `shell` input schema 与追加描述。 |
| `src/pipe.ts` | 命令结尾 `| head` / `| tail` 管道的解析与单次调用的原地改写。 |
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
8. 用 `{"tail": 3}` 执行 `seq 1 200000`，然后要求模型展示另一段。模型必须用 `read` 工具读取报告的文件，而不是重跑命令。
9. 要求模型查看一条大段输出的命令。模型必须传 `tail`、`head` 或 `lines`，而不是把命令接到 `head` 或 `tail`。然后把 `windowHint` 设为 `false` 并重新加载，确认该段落不再注入。
10. 把 `pipeWindow` 设为 `true` 并重新加载，执行 `seq 1 100 | tail -n 3`。命令必须全量执行，marker 必须报告 98–100 行（共 100 行），且结果被截断时带保存路径。再把 `pipeWindow` 设回 `false`，确认同样的调用保留管道。
11. 检查 `~/.local/share/opencode/log/opencode.log` 是否有 `[command.window]` 警告。
