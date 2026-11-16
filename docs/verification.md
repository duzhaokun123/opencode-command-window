# 真机验证

本文件记录插件在真实 OpenCode 会话中的验证方法与已确认的结论，只供维护者参考；面向使用者的人工验证清单在 README 的“手动验证”小节。结论针对 OpenCode v2.3.0，升级上游版本后需要重跑。

## 验证方法

- 真机验证前必须隔离全局插件：OpenCode 按插件 id 去重，保留先加载的实例。若全局配置里已有指向本仓库的目录条目（id 同为 `command.window`），项目里声明的 npm 条目仍会加载（日志出现两条 `loading plugin`），但生效的是先前那个实例，其 `options` 不生效，表现为照旧注入内置文本。用独立的 `XDG_CONFIG_HOME`（里面放一份去掉本仓库条目的全局配置副本）即可隔离；`OPENCODE_CONFIG` 环境变量在本版本不生效。
- `opencode run` 默认连到常驻的 `opencode serve --service` 后台进程（用的是启动它的那份配置）；验证必须加 `--standalone`，隔离用的 `XDG_CONFIG_HOME` 才会作用于本次运行。
- 观察系统提示词的可靠方法：临时项目里放一个 `.opencode/plugins/` 观察者插件，在 `ctx.session.hook("context")` 里把 `event.system` 延迟一个 tick（`setTimeout(…, 0)`）再快照。各插件按注册顺序执行钩子，先注册的钩子只能看到注入前的 part。
- 验证 `pipeWindow` / `pipeWarning` 时提示词要求 command 逐字执行（带或不带管道）并禁止窗口参数，才能区分“模型自己加的参数”与“插件的改写”。
- 日志位于 `~/.local/share/opencode/log/opencode.log`。正常加载的判据是出现 `msg="loading plugin"` 且没有 `[command.window]` 警告。

## 已确认的结论

### 窗口参数

- 插件从 `src/index.ts` 加载，`ctx.tool.transform` 生效，模型可直接传 `tail` / `head`。
- 未触发截断时 marker 形如 `[showing lines 98-100 of 100 (tail 3); full output was not saved because the result was not truncated]`。
- 触发截断时 marker 带保存路径，形如 `[showing lines 1-2 and 199999-200000 of 200000 (head 2, tail 2); full output saved to …]`，大段中间内容以 `[... 199996 lines omitted ...]` 占位；`lines: { start, end }` 返回 `[showing lines 5-6 of 20 (lines 5-6); …]`。
- 保存路径由 OpenCode 给出，格式随上游版本变化：曾为 `~/.local/share/opencode/shell/<hash>/sh_<id>.out`，v2.3.0 为 `~/.local/share/opencode/shell/global/sh_<id>.out`；marker 只透传该路径。
- `metadata.window` 与 `metadata.truncated` 会出现在工具结果 metadata 中。
- 回读路径成立：模型拿到 marker 与路径后用 `read`（`offset` / `limit`）读取保存文件作答，没有重跑命令（用一次性 guard 文件排除重跑）。

### 提示词注入

- 主请求的系统提示词里有两个独立 part，`metadata.kind` 分别是 `window-hint`（内置文本 597 字符）与 `read-back`（637 字符），各注入一次，没有重复。
- `windowHint: false` 与 `readBack: false` 同时关闭时两段都不出现，系统提示词回到注入前的 5 个 part。
- 自定义 `windowHintText` / `readBackText` 逐字替换内置段落，且模型照做。
- 请求里的 `shell` 工具描述末尾带窗口段落，`head` / `tail` / `lines` / `max_bytes` 在 input schema 中。

### pipeWindow

- `true`：`seq 1 100 | tail -n 3` 被改写为全量执行（marker 里的总数是 100）并返回 98–100 行加 marker；`| head -n 5` 返回 1–5 行加 marker。
- 默认关闭：同一调用只有 98/99/100 三行，无 marker，命令未被改写。
- 只改写单一命令结尾的管道：`cd /tmp && seq 1 100 | tail -n 3`、`cd /tmp; seq 1 100 | tail -n 3` 都保持原样、无 marker。
- `| head -n 20 | tail -n 5` 这类链保持原样（输出 16–20，无 marker），改写器只处理直接接在命令后的单级 `head` / `tail`。

### pipeWarning

- `true`：`seq 1 100 | tail -n 3` 的工具结果首行是 `[window warning: …]`，正文 98/99/100 完整保留。CLI 回显只画出第一个 content part，正文只在模型收到的结果里可见。
- 默认关闭：同一调用只有 98/99/100，没有提醒。
- 与 `pipeWindow` 同时开启时，结尾管道在执行前已被改写成窗口参数，因此不会触发提醒。

### 发布产物

- 从 npm 安装 `@o0kam1/opencode-command-window` 的 `0.1.0`、`0.2.0`，以及 `npm pack` 打出的 `0.3.0` tarball 都能正常加载并生效，日志无 `[command.window]` 警告。
- 运行中的会话只会在与插件无关时出现上游的 console 401 WARN，不影响结论。
