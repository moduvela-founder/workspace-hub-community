# 部署与规则使用指南

通过 Git clone 或下载 ZIP 获取源码后，都使用以下部署步骤。Workspace Hub 用来整理项目、工具、流程和参考资料，并给新的 Codex 会话提供短索引；项目源码与文档保留在各自目录。

包内保留通用 Hub、交付、UI、存储和协作规则及项目模板，只提供一个虚构的 `demo-project` 演示项目。真实产品、具体工具适配器和历史验证案例不随包提供。从 `docs/hub/README.md` 按任务读取规则，已读且未变的正文按规则复用。

## 先启动示例

需要 Node.js **22.13 或更高版本**和 pnpm **11.25.0**，具体以 `package.json` 为准。第一次安装依赖需要联网；源码不包含 `node_modules` 或已编译应用。

先获取源码：

```sh
git clone https://github.com/moduvela-founder/workspace-hub-community.git
cd workspace-hub-community
```

也可以从 GitHub 下载 ZIP，解压到准备长期保存的目录并在终端进入该目录。之后依次执行：

```sh
# 先预览；不修改文件
node scripts/setup-share.mjs
# 确认后创建本机配置和一个虚构演示项目
node scripts/setup-share.mjs --apply
pnpm install --ignore-scripts --frozen-lockfile
pnpm build
pnpm start
```

用浏览器打开 <http://127.0.0.1:4176/hub>。终端保持运行，按 Ctrl+C 停止；本机访问即可，不需要账户或云服务。若 4176 已被其他程序占用，先保留原服务，不要为了试用覆盖已有启动项。

初始化脚本只依赖 Node 标准库，会按当前 Hub 目录生成 `hub.config.json` 和 `catalog/` 的三份登记文件，仅登记 Hub 工具自身与唯一虚构项目 `demo-project`。配置已经存在时会拒绝覆盖；不要靠删除自己的登记来重复初始化。

基础部署已在 macOS 验证；Windows、Linux 尚未实机验收。macOS 登录自启动、MCP 进程管理属于可选功能，入门阶段使用上述手动启动即可。

## 换成自己的目录

想从第一次初始化就选择自己的目录，可用下面的命令替代上面的默认初始化。两项参数均需填写**已经存在的绝对目录**，并先去掉 `--apply` 预览：

```sh
node scripts/setup-share.mjs --projects-root "/你的项目目录" --large-files-root "/你的大文件目录" --apply
```

`--projects-root` 指定允许读取的项目根；Hub 自身根目录也会保留。已有配置初始化完成后，在 `hub.config.json` 的 `roots` 和排除项中维护自己的读取范围，在 `catalog/assets.json` 维护项目及仓库关系；修改登记后运行 `node scripts/hub.mjs validate`。示例卡不是你的真实项目登记，也不要将整个系统盘设为读取根。

`--large-files-root` 可以是外置盘、内置盘上的指定文件夹或已经挂载的存储目录。选择保存在本机 `.local/storage.json`，**只记录存储约定**，不会搬文件、创建外盘挂载点、调整 Docker 或强制更改所有工具的输出。未设置时可沿用各仓库的 `.local/build`、`.local/evidence`、`.local/artifacts`。工具支持的具体路径仍由项目构建参数、应用设置或自己的环境文档确定。

源码、证据、可重建缓存及正式工件继续分别处理。外置盘缺失时先核对挂载和身份，不把历史路径当作当前可用目录，也不自动清理旧内容。完整约定见 `docs/hub/storage-and-outputs.md`。

## 把规则接到自己的项目

1. 阅读 `docs/hub/project-rules.md`。团队默认可在 `docs/hub/` 中调整；个人目录、机器及存储身份留在自己的环境文档；产品目标、参数与验收留在产品原仓库。
2. 原项目的 `AGENTS.md` 保留原有约束，只合并指向实际 Hub 目录的短入口。新项目可采用 README、AGENTS、STATUS、MANUAL_STEPS 四文件模板；已有合适文档则映射，不另建重复事实来源。
3. 可先预览初始化命令；它只补缺失文件，不自动登记项目，也不升级已有 AGENTS：

```sh
node scripts/hub.mjs init --path "/已在读取根内的项目主目录" --id demo-project --title "示例项目（虚构）" --kind product
```

确认预览范围后才加 `--apply`。开发过程中让 Codex 维护本次变化的事实，普通分析不更新项目状态。新探索优先最小 DEMO；具体终点、门禁与后续产品化仍需结合本项目约定。

规则入口分三层，均先预览再合并，不覆盖原有约束：

| 层级 | 包内入口 | 采用方式 |
| --- | --- | --- |
| 全局（可选） | `examples/codex/GLOBAL-AGENTS-SNIPPET.md` | 临时子 agent 的使用边界及 Hub 短路由；先读使用者已有全局规则，最小合并、去重 |
| 工作空间 | `templates/workspace/AGENTS.md` | 通用工作空间入口模板；按实际 Hub 目录替换占位后，合并到自己的工作空间 AGENTS |
| 独立项目 | `templates/entity/AGENTS.md` | 项目短入口及自身约束；`init` 仅补缺失文件，已有 AGENTS 需按预览结果合并 |

详细 UI、DEMO 与输出规则维护在 `docs/hub/`，例如 `ui-delivery.md`、`delivery-workflow.md`、`storage-and-outputs.md`。这些是 Hub 自维护、按需读取的共享规范，不需要为此另下载一个独立 agent 或强制安装外部包。

Codex 是否自动读取某份 AGENTS 取决于本会话适用目录和 Git 项目根，不能保证工作空间父目录的 AGENTS 自动覆盖所有独立 Git 仓库。因此每个独立项目仍应保留短入口，或由使用者选择合并全局短路由；详细规则不复制到各层 AGENTS。

包内不附带原作者的真实全局或工作空间 AGENTS。可让 Codex 按团队偏好采用上面的通用建议，不直接覆盖原文件或修改无关设置。只采用项目入口也可以，不要求修改全局文件。

通用技能在 `skills/` 中，按自己的 Codex 安装方式选用；安装位置或符号链接应指向本次实际目录，移动 Hub 后重新核对。`session-closeout` 仅显式调用。具体工具和外部角色包不在本次分享范围。

可复制给 Codex：

> 请读取当前 Workspace Hub 的 README，按我的实际项目根目录与存储位置核对配置；按需采用现有规则，保留原项目约束，只补缺失文档。在已有授权内读取我的现有全局 AGENTS，参考 examples/codex/GLOBAL-AGENTS-SNIPPET.md 检查并最小合并所需全局规则与子 agent 约定；参考工作空间和项目模板，先按实际 Hub 目录替换占位并预览合并，去重、保留原约束，不覆盖原文件或修改无关设置。不要假设父工作空间 AGENTS 自动覆盖独立 Git 仓库。先以一个项目验证登记和短索引，不批量改旧项目、不安装额外工具、不迁移或清理资料。

## 需要配置的目录

只需核对以下目录；模板中的路径占位按本机实际位置替换，不附全量路径清单或原始值映射：

| 配置项 | 在自己机器上怎么处理 |
| --- | --- |
| Hub 目录 | 本机 Hub 目录（克隆或解压的位置）；初始化配置自动使用它，合并规则入口时也指向这里 |
| 项目根目录 | 在 `--projects-root` 或 `hub.config.json` 中选择自己的已有项目目录 |
| 大文件目录（可选） | 在 `--large-files-root` 中选择自己的外盘或普通指定目录，仅记录约定 |

自己的全局规则、技能安装目录和环境规程沿用本人现有配置。示例演示登记与文档结构，不代表任何产品、工具或设备已经验收。

DEMO 推进方式、UI 视口默认值、GitLab/SMB 发布核对及版本保留等是本套规则的默认约定。团队可按自身交付、发布渠道和验收要求调整；它们不代表你所在团队已经批准相同操作。

## 仓库范围与来源

本仓库只提供通用规则、模板、活跃运行时和一个虚构项目，不提供真实产品、工具适配器或历史验证案例。需要具体外部能力时，按自己的项目另行配置。

自己的目录登记、机器配置和账号设置在本机维护，不把它们当成通用示例。全局规则仅提供可选的合并建议。

基于 Project Minder 固定源码派生，保留 `LICENSE` 与 `PROVENANCE.md`。如需导出 ZIP，可运行 `node scripts/export-share.mjs`；导出需要 Python 3 标准库，默认产物在 `.local/artifacts/share/`，并为该包生成校验清单。正常 Git clone 或下载源码后的部署不依赖导出清单。
