# Agent Memory — opencode-command-window

本文件是本仓库的常驻 agent 指令，跨会话生效（新会话打开本仓库时自动加载）。它不绑定任何具体 CLI、harness 或模型。

## 仓库位置

- 规范仓库：<https://git.o0kam1.dev/HumanlessCode/opencode-command-window>（即 `origin`）。
- GitHub 仓库 <https://github.com/duzhaokun123/opencode-command-window> 是它的镜像：代码改动与 pull request 提交到规范仓库。镜像的 `main` 与 `v*` tag 由 `.gitea/workflows/mirror.yml` 自动推送（细节见 `docs/release.md`）；GitHub 另外承载必须在那边维护的自动化（Dependabot 依赖更新、镜像上的 CI check），其 PR 仅作更新提示，GitHub 的 issue 可用于提问与讨论。
- npm 包名是 `@o0kam1/opencode-command-window`，发布账号为 `o0kam1`。`repository` 指向 GitHub 镜像，因为 npm 的可信发布与 provenance 要求它与发布来源仓库一致；`homepage` 指向规范仓库，`bugs` 指向 GitHub issues；tag 与 release 只在规范仓库创建。
- 修改 `README.md` / `README.zh.md` 时保留顶部的镜像声明。
- 依赖更新由 GitHub 镜像上的 Dependabot 负责，配置在 `.github/dependabot.yml`：`npm` 生态覆盖 `package.json` 与 `pnpm-lock.yaml`，`github-actions` 生态覆盖 workflow 中的 action 版本；每周检查一次，minor 与 patch 合并成一个 PR，major 单独开 PR。Dependabot 只运行在 GitHub 侧，它的 PR 仅作为更新提示，实际改动仍在规范仓库完成并推送。

## 项目说明

`opencode-command-window` 是一个 OpenCode V2 服务端插件（插件 id `command.window`，npm 包 `@o0kam1/opencode-command-window`）：

- 在 `ctx.tool.transform` 中给内置 `shell` 工具补上 `tail`、`head`、`lines`、`max_bytes` 参数；
- 在 `ctx.tool.hook("execute.after")` 中按模型声明的范围重算返回内容；
- `pipeWindow` 选项（默认关闭）开启时，在 `ctx.tool.hook("execute.before")` 中把命令结尾的 `| head` / `| tail` 管道改写成窗口参数；
- 在 `ctx.session.hook("context")` 中向主 Agent 请求注入两段系统提示词：用窗口参数限制输出、回读保存文件；
- 不执行命令、默认不改写命令、不接管权限；不传窗口参数时结果与安装前逐字节一致。

主要文件：

```text
src/index.ts    Plugin.define 接线：选项、schema/描述变换、系统提示词注入、execute.before/execute.after hook
src/options.ts  插件选项校验与默认值
src/prompt.ts   截断参数与回读段落、幂等 system part 注入
src/schema.ts   shell 的新 input JSON Schema 与追加描述
src/window.ts   参数解析、校验、marker 渲染（纯函数）
src/scan.ts     文件/内联文本的流式扫描
src/apply.ts    把窗口应用到 execute.after 事件
src/pipe.ts     命令结尾 | head / | tail 管道的解析与改写（纯函数，pipeWindow 开启时生效）
```

上游依据：OpenCode v2.3.0 的 `packages/core/src/tool/plugin/shell.ts`、`packages/core/src/tool.ts`、`packages/core/src/session/runner/step.ts`、`packages/core/src/tool-output.ts`。插件 API 文档见 <https://opencode.ai/docs/build/plugins/server>。

## 工作纪律

- 每完成一个独立、可验证的步骤（功能改动、清理、类型检查/测试通过、文档与配置更新等）就**立即 `git commit`**。
- 提交信息遵循 conventional commit 风格（如 `feat:`、`fix:`、`docs:`、`refactor:`、`chore:`），并提供简洁正文。
- 模型身份写在提交作者：`git commit --author "DeepSeek Flash <deepseek-flash@llm.invalid>"`；Agent 应用身份写在正文末尾的 `Co-authored-by` 尾注（实际运行版本，如 `opencode v2.3.0`，不写邮箱）。
- 不允许把多个步骤攒到会话末尾一次性提交。
- 未获用户明确要求时，不要 `git push`、创建标签、创建 release 或触发发布。
- **禁止 agent 直接向 `github` 远程推送任何内容**，包括 `main`、tag 与 force-push。镜像同步只由 `.gitea/workflows/mirror.yml` 完成；agent 对 `github` 远程只做读取与对照。

## 发布

具体流程只维护在 `docs/release.md`，本节不复述。发布由 GitHub 镜像上的 `.github/workflows/release.yml` 用 npm 可信发布（OIDC）完成：tag 经 `.gitea/workflows/mirror.yml` 同步到镜像后触发。agent 参与发版的门槛与远程限制见「工作纪律」一节：用户明确要求时可以推送 `main` 到 `origin`、创建并推送 tag、创建 release，但任何情况下都不得向 `github` 远程推送。

## 已验证行为

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
- 真机验证前必须隔离全局插件：OpenCode 按插件 id 去重，保留先加载的实例。若全局配置里已有指向本仓库的目录条目（id 同为 `command.window`），项目里声明的 npm 条目仍会加载（日志出现两条 `loading plugin`），但生效的是先前那个实例，其 `options` 不生效，表现为照旧注入内置文本。用独立的 `XDG_CONFIG_HOME`（里面放一份去掉本仓库条目的全局配置副本）即可隔离；`OPENCODE_CONFIG` 环境变量在本版本不生效。
- 观察系统提示词的可靠方法：临时项目里放一个 `.opencode/plugins/` 观察者插件，在 `ctx.session.hook("context")` 里把 `event.system` 延迟一个 tick（`setTimeout(…, 0)`）再快照。各插件按注册顺序执行钩子，先注册的钩子只能看到注入前的 part。

## 提交前自检

```sh
pnpm check   # tsc --noEmit + vitest run
```

CI（`.github/workflows/ci.yml`）在 push 到 `main` 与 PR 时跑同一组命令；Gitea 只读 `.gitea/workflows/`，所以它要等镜像同步到 GitHub 后才运行。

插件行为只能在真实 OpenCode 会话里验证：安装后保存配置触发热重载，或执行 `/reload`；日志位于 `~/.local/share/opencode/log/opencode.log`。验证项见 README 的“验证”一节。

## 实现约定

- **hook 内绝不抛异常**。Promise hook 的回调用 `Effect.promise` 包装，reject 会成为 defect；所有可预见的失败都降级为“原结果 + 一行说明”。
- `execute.before` 对 `event.input` 的就地修改会原样传给工具执行（v2.3.0 的 `beforeExecute` 把同一引用交给 `executeTool`）；`src/pipe.ts` 的管道改写依赖这一点，改写只动 `command` 与 `head`/`tail`，不添加 schema 之外的字段（input schema 是 `additionalProperties: false`）。
- `Tool.Result` 的字段是 `readonly`，替换结果必须整体重新赋值 `event.result = { ...event.result, ... }`，不能逐字段改写。
- `shell` 的 `content` 除正文外还可能有退出码/超时提示；窗口化只能替换正文 part，其余 part 必须保留。
- marker 里的 `full output saved to <path>` 是既有消费者依赖的短语，不得改写。
- 截断参数提示与回读提示都只注入 `context` hook（主 Agent 请求）；`compaction` 与 `generate` 只同步工具描述。两段提示各自用 system part 的 `metadata.kind`（`window-hint` / `read-back`）判断幂等，不靠文本匹配。
- 插件选项只来自 `opencode.json(c)` 的 `plugins` 条目 `options`；`plugins/` 目录自动发现拿到的是 `{}`。无效值回退默认并告警，绝不抛异常。
- 不实现 `grep` 过滤；需要过滤时由命令自身管道完成。
- 窗口扫描预算 5 秒；内存占用以 `max_bytes` 为上界，`tail` 使用环形缓冲。
- 只用 `node:` 内建模块；`@opencode/plugin` 仅用于类型与 `Plugin.define`。
- 遵循现有代码风格：Tab 缩进、双引号、分号、显式 `.ts` 扩展名导入、TypeScript `strict`。
- 不引入运行时依赖，不修改全局 `tool_output` 配置，不改写命令。

## 文档维护

- `README.md`（英文）与 `README.zh.md`（中文）描述安装、参数、marker 与限制；行为变更时同步更新。
- `LICENSE` 为 MIT，版权人 duzhaokun123（2026）。
- `docs/release.md` 是唯一的发版依据，只供维护者使用。发版流程与包元数据变化时更新该文件；两份 README 不记录发版流程，因为它们面向使用者。
