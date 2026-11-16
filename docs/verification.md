# 真机验证记录

本文件记录插件在真实 OpenCode 会话中的验证方法与结果，只供维护者参考；面向使用者的人工验证清单在 README 的“验证”一节。记录针对 OpenCode v2.3.0，升级上游版本后需要重跑。

## 验证方法

- 真机验证前必须隔离全局插件：OpenCode 按插件 id 去重，保留先加载的实例。若全局配置里已有指向本仓库的目录条目（id 同为 `command.window`），项目里声明的 npm 条目仍会加载（日志出现两条 `loading plugin`），但生效的是先前那个实例，其 `options` 不生效，表现为照旧注入内置文本。用独立的 `XDG_CONFIG_HOME`（里面放一份去掉本仓库条目的全局配置副本）即可隔离；`OPENCODE_CONFIG` 环境变量在本版本不生效。
- `opencode run` 默认连到常驻的 `opencode serve --service` 后台进程（用的是启动它的那份配置）；验证必须加 `--standalone`，隔离用的 `XDG_CONFIG_HOME` 才会作用于本次运行。
- 观察系统提示词的可靠方法：临时项目里放一个 `.opencode/plugins/` 观察者插件，在 `ctx.session.hook("context")` 里把 `event.system` 延迟一个 tick（`setTimeout(…, 0)`）再快照。各插件按注册顺序执行钩子，先注册的钩子只能看到注入前的 part。

## 验证记录

2026-11-15 在真实 OpenCode v2.3.0 会话（临时项目 `.opencode/plugins/command-window` → 本仓库软链）中核实：

- 插件从 `src/index.ts` 加载，`ctx.tool.transform` 生效，模型可直接传 `tail`/`head`。
- `seq 1 100` + `tail: 3` → 正文末尾 `[showing lines 98-100 of 100 (tail 3); full output was not saved because the result was not truncated]`。
- `seq 1 200000` + `head: 2, tail: 2` → `[showing lines 1-2 and 199999-200000 of 200000 (head 2, tail 2); full output saved to /home/<user>/.local/share/opencode/shell/<hash>/sh_<id>.out]`。
- 保存文件的实际路径格式是 `~/.local/share/opencode/shell/<hash>/sh_<id>.out`；2026-11-15 复验时 OpenCode v2.3.0 写的是 `~/.local/share/opencode/shell/global/sh_<id>.out`，不再按 hash 分子目录。marker 只透传 OpenCode 给出的路径，格式随 OpenCode 版本变化。
- `metadata.window` 与 `metadata.truncated` 出现在工具结果 metadata 中，日志无 `[command.window]` 警告。
- 2026-11-15 在同一方式搭建的临时项目 `/var/tmp/opencode/verify-cw` 中核实回读路径：`seq 1 200000` + `tail: 3` 返回 marker 与保存路径后，模型用 `read`（`offset`/`limit`）读取保存文件的 1000–1005 行并正确回答第 1001、1003 行，没有重跑命令（命令用一次性 guard 文件保证重跑必然失败）。
- 2026-11-15 从 npm 安装真实产物（`@o0kam1/opencode-command-window@0.1.0`）后，在真实会话中执行 `seq 1 200000` + `{"head":2,"tail":2}`，返回 `[... 199996 lines omitted ...]` 占位与 `[showing lines 1-2 and 199999-200000 of 200000 (head 2, tail 2); full output saved to ...]`，日志无 `[command.window]` 警告。
- 自定义 `readBack` / `readBackText` 与 `windowHint` / `windowHintText` 已在真实会话验证（2026-11-15，见下）。
- 2026-11-15 用已发布的真实产物 `@o0kam1/opencode-command-window@0.2.0`（从 `~/.cache/opencode/npm/@o0kam1/opencode-command-window@0.2.0/<timestamp>/node_modules/…/src/index.ts` 加载）核实：
  - 主请求的系统提示词里出现两个独立 part，`metadata.kind` 分别是 `window-hint`（内置文本 597 字符）与 `read-back`（637 字符），各注入一次，没有重复。
  - `windowHint: false` 与 `readBack: false` 同时关闭时两段 part 都不出现，系统提示词回到注入前的 5 个 part。
  - 自定义 `windowHintText` / `readBackText` 逐字替换内置段落，且模型照做：命令变成 `echo NPM-HINT; seq 1 200000`，回答首行出现 `NPM-READBACK`。
  - `seq 1 200000` + `tail: 3` → `[showing lines 199998-200000 of 200000 (tail 3); full output saved to /home/<user>/.local/share/opencode/shell/global/sh_<id>.out]`；`seq 1 100` + `tail: 3` → `[showing lines 98-100 of 100 (tail 3); full output was not saved because the result was not truncated]`；`seq 1 200000` + `head: 2, tail: 2` → `[... 199996 lines omitted ...]` 占位；`seq 1 20` + `lines: { start: 5, end: 6 }` → `[showing lines 5-6 of 20 (lines 5-6); …]`。
  - 请求里的 `shell` 工具描述末尾带 0.2.0 的窗口段落，`head`/`tail`/`lines`/`max_bytes` 已在 input schema 中。
  - 日志里能看到 `msg="loading plugin" id=@o0kam1/opencode-command-window@0.2.0`，无 `[command.window]` 警告。
- 2026-11-16 在真实 OpenCode v2.3.0 会话中核实 `pipeWindow`（临时项目 `/var/tmp/opencode/verify-cw-pipe-on` 与 `-off`，用 `/var/tmp/opencode/cw-pipe-xdg` 的无本仓库条目全局配置副本隔离，`opencode run --standalone --auto -m local2/deepseek-flash`，提示词要求 command 逐字带管道并禁止窗口参数）：
  - `pipeWindow: true`：`seq 1 100 | tail -n 3` → 正文 98–100 行加 `[showing lines 98-100 of 100 (tail 3); full output was not saved because the result was not truncated]`（总数 100 证明命令被改写为全量执行）；`seq 1 100 | head -n 5` → `[showing lines 1-5 of 100 (head 5); …]`；`seq 1 100 | head -n 20 | tail -n 5` → 输出 16–20 且无 marker（head→tail 链保持原样）。
  - 默认（无 `options`）：同一 `seq 1 100 | tail -n 3` → 只有 98/99/100 三行，无 marker，命令未被改写。
  - 日志出现 `msg="loading plugin" id=/home/o0kam1/…/opencode-command-window`（从 `src/index.ts` 加载），无 `[command.window]` 警告；仅有与插件无关的 opencode.ai console 401 WARN（不带插件的运行同样出现）。
- 2026-11-16 在同一方式的真实会话中核实「拼接命令不改写」（临时项目 `/var/tmp/opencode/verify-cw-join-on` 与 `-on-plain`，同样用 `cw-pipe-xdg` 隔离、`--standalone --auto -m local2/deepseek-flash`，`pipeWindow: true`，提示词要求命令逐字执行并禁止窗口参数）：
  - `cd /tmp && seq 1 100 | tail -n 3` → 只有 98/99/100 三行，无 marker；`cd /tmp; seq 1 100 | tail -n 3` 同样无 marker，命令里的管道保持原样。
  - `seq 1 100 | tail -n 3` → 98–100 行加 `[showing lines 98-100 of 100 (tail 3); full output was not saved because the result was not truncated]`，单一命令的改写不受影响。
  - 日志出现 `msg="loading plugin" id=/home/o0kam1/…/opencode-command-window`（从 `src/index.ts` 加载），无 `[command.window]` 警告。
- 2026-11-16 在同一方式的真实会话中核实 `pipeWarning`（临时项目 `/var/tmp/opencode/verify-cw-warn-on` 与 `-off`，同样用 `cw-pipe-xdg` 隔离、`--standalone --auto -m local2/deepseek-flash`，提示词要求命令逐字带管道并禁止窗口参数）：
  - `pipeWarning: true`：`seq 1 100 | tail -n 3` 的工具结果首行是 `[window warning: …]`，正文 98/99/100 完整保留（模型按要求复述了整个工具结果）；CLI 回显只画出第一个 content part，正文只在模型收到的结果里可见。
  - 默认（无 `options`）：同一调用只有 98/99/100，没有提醒。
  - 日志出现 `msg="loading plugin" id=/home/o0kam1/…/opencode-command-window`（从 `src/index.ts` 加载），无 `[command.window]` 警告。
