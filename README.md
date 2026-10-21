# Workspace Hub

本地项目与能力看板，为多项目、多仓库开发提供一个清晰入口。把当前目标、阶段、待办和可复用工具放在一起，并通过短索引交接给新的 Codex 会话。

项目源码和文档保留在原目录，Hub 读取登记与项目状态，形成可浏览的总览。仓库提供通用开发规则和模板，首次初始化只创建工具自身登记及一个虚构的 `demo-project`。

## 可以做什么

- 按产品、工具、框架、流程、技能、AI 内容和资料分类，搜索、筛选并调整卡片顺序。
- 一个产品关联多个仓库，同一仓库供多个产品复用，无需为了展示复制源码。
- 从项目文档读取目标、阶段、起始日期和人工待办，保留来源入口。
- 复制项目短索引，配合 CLI 查找入口，让新会话读取当前依据。
- 采用 DEMO 与产品化、UI 验收、文档和输出目录等按需规则，减少重复说明。

默认只在本机运行，不需要云账户。项目自己的规则、需求和验收文档仍然是事实来源。

## 本地部署

准备 Git、Node.js **>=22.13** 和 pnpm **11.25.0**，版本以 `package.json` 为准；首次安装依赖需要联网。

```sh
git clone https://github.com/moduvela-founder/workspace-hub-community.git
cd workspace-hub-community

# 预览本机配置，然后创建示例登记
node scripts/setup-share.mjs
node scripts/setup-share.mjs --apply
pnpm install --ignore-scripts --frozen-lockfile
pnpm build
pnpm start
```

打开 <http://127.0.0.1:4176/hub>，终端保持运行，Ctrl+C 停止。通过 GitHub 下载 ZIP 时，解压并进入目录后从 `setup-share.mjs` 开始，使用方式相同。初始化拒绝覆盖已有配置或登记。

如需在第一次初始化时指定目录，先预览，再给下面的命令加 `--apply`：

```sh
node scripts/setup-share.mjs --projects-root "/自己的现有项目目录" --large-files-root "/自己的现有大文件目录"
```

大文件位置可以是外置盘或普通文件夹。此选项只记录约定，不迁移资料或更改 Docker、构建工具设置。详细步骤见[部署与规则指南](docs/share/README.md)或[纯文本说明](使用说明.txt)。基础部署已在 macOS 验证；Windows/Linux 尚未实机验收，macOS 自启动和服务管理为可选功能。

## 规则与会话交接

| 入口 | 用途 |
| --- | --- |
| [按任务读取规范](docs/hub/README.md) | Hub、交付、UI、文档及存储规则 |
| [全局规则合并建议](examples/codex/GLOBAL-AGENTS-SNIPPET.md) | 可选的子 agent 约定与 Hub 短路由 |
| [工作空间模板](templates/workspace/AGENTS.md) | 多项目目录的通用入口 |
| [项目模板](templates/entity/AGENTS.md) | 独立项目的短入口、约束和更新触发 |

先读取自己的现有规则，替换实际 Hub 路径，再最小合并、去重并保留原约束。父工作空间 AGENTS 不保证自动覆盖独立 Git 仓库；各项目保留短入口，或自行选用全局短路由。详细规则按当前任务读取，不必每个会话全部加载，也不需要另下载一个 agent。

完成初始化和依赖安装后，可直接使用 CLI：

```sh
node scripts/hub.mjs resolve --id demo-project
node scripts/hub.mjs reference --id demo-project
node scripts/hub.mjs rules --summary --json
```

`reference` 输出可粘贴给新会话的索引；`resolve` 返回项目和文档入口。索引提供导航，不自动执行项目代码、部署或设备操作。更多项目接入与可复制提示词见[详细指南](docs/share/README.md)。

## 来源与许可

基于 [Project Minder](https://github.com/joshuatownsend/project-minder) 固定源码派生，提供本地目录、CLI、规则和模板。保留原 MIT [LICENSE](LICENSE)，来源说明见 [PROVENANCE.md](PROVENANCE.md)。
