# Agent Memory — opencode-command-window

本文件是本仓库的常驻 agent 指令，跨会话生效（新会话打开本仓库时自动加载）。它不绑定任何具体 CLI、harness 或模型。

## 项目说明

`opencode-command-window` 是一个 OpenCode V2 服务端插件（插件 id `command.window`）：

- 在 `ctx.tool.transform` 中给内置 `shell` 工具补上 `tail`、`head`、`lines`、`max_bytes` 参数；
- 在 `ctx.tool.hook("execute.after")` 中按模型声明的范围重算返回内容；
- 不执行命令、不改写命令、不接管权限；不传窗口参数时结果与安装前逐字节一致。

主要文件：

```text
src/index.ts    Plugin.define 接线：schema/描述变换 + execute.after hook
src/schema.ts   shell 的新 input JSON Schema 与追加描述
src/window.ts   参数解析、校验、marker 渲染（纯函数）
src/scan.ts     文件/内联文本的流式扫描
src/apply.ts    把窗口应用到 execute.after 事件
```

上游依据：OpenCode v2.3.0 的 `packages/core/src/tool/plugin/shell.ts`、`packages/core/src/tool.ts`、`packages/core/src/session/runner/step.ts`、`packages/core/src/tool-output.ts`。插件 API 文档见 <https://opencode.ai/docs/build/plugins/server>。

## 工作纪律

- 每完成一个独立、可验证的步骤（功能改动、清理、类型检查/测试通过、文档与配置更新等）就**立即 `git commit`**。
- 提交信息遵循 conventional commit 风格（如 `feat:`、`fix:`、`docs:`、`refactor:`、`chore:`），并提供简洁正文。
- 模型身份写在提交作者：`git commit --author "DeepSeek Flash <deepseek-flash@llm.invalid>"`；Agent 应用身份写在正文末尾的 `Co-authored-by` 尾注（实际运行版本，如 `opencode v2.3.0`，不写邮箱）。
- 不允许把多个步骤攒到会话末尾一次性提交。
- 未获用户明确要求时，不要 `git push`、创建标签、创建 release 或触发发布。

## 已验证行为

2026-11-15 在真实 OpenCode v2.3.0 会话（临时项目 `.opencode/plugins/command-window` → 本仓库软链）中核实：

- 插件从 `src/index.ts` 加载，`ctx.tool.transform` 生效，模型可直接传 `tail`/`head`。
- `seq 1 100` + `tail: 3` → 正文末尾 `[showing lines 98-100 of 100 (tail 3); full output was not saved because the result was not truncated]`。
- `seq 1 200000` + `head: 2, tail: 2` → `[showing lines 1-2 and 199999-200000 of 200000 (head 2, tail 2); full output saved to /home/<user>/.local/share/opencode/shell/<hash>/sh_<id>.out]`。
- 保存文件的实际路径格式是 `~/.local/share/opencode/shell/<hash>/sh_<id>.out`。
- `metadata.window` 与 `metadata.truncated` 出现在工具结果 metadata 中，日志无 `[command.window]` 警告。

## 提交前自检

```sh
pnpm check   # tsc --noEmit + vitest run
```

CI（`.github/workflows/ci.yml`）在 push 到 `main` 与 PR 时跑同一组命令。

插件行为只能在真实 OpenCode 会话里验证：安装后保存配置触发热重载，或执行 `/reload`；日志位于 `~/.local/share/opencode/log/opencode.log`。验证项见 README 的“验证”一节。

## 实现约定

- **hook 内绝不抛异常**。Promise hook 的回调用 `Effect.promise` 包装，reject 会成为 defect；所有可预见的失败都降级为“原结果 + 一行说明”。
- `Tool.Result` 的字段是 `readonly`，替换结果必须整体重新赋值 `event.result = { ...event.result, ... }`，不能逐字段改写。
- `shell` 的 `content` 除正文外还可能有退出码/超时提示；窗口化只能替换正文 part，其余 part 必须保留。
- marker 里的 `full output saved to <path>` 是既有消费者依赖的短语，不得改写。
- 不实现 `grep` 过滤；需要过滤时由命令自身管道完成。
- 窗口扫描预算 5 秒；内存占用以 `max_bytes` 为上界，`tail` 使用环形缓冲。
- 只用 `node:` 内建模块；`@opencode/plugin` 仅用于类型与 `Plugin.define`。
- 遵循现有代码风格：Tab 缩进、双引号、分号、显式 `.ts` 扩展名导入、TypeScript `strict`。
- 不引入运行时依赖，不修改全局 `tool_output` 配置，不改写命令。

## 文档维护

- `README.md`（英文）与 `README.zh.md`（中文）描述安装、参数、marker 与限制；行为变更时同步更新。
- LICENSE 暂未添加；署名确定后补 MIT 文本。
