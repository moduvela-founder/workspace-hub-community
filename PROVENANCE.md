# 来源与许可

Workspace Hub Community 是由 Moduvela 维护的通用本地项目目录与规则工具，公开仓库为 <https://github.com/moduvela-founder/workspace-hub-community>。

## 上游来源

- 上游：Josh Townsend / [Project Minder](https://github.com/joshuatownsend/project-minder)。
- 固定源码提交：`0cef25507ce93e9b9eeeb819b71687d238a9d4da`。
- 上游 package.json 版本：`1.16.12`。
- 固定来源获取日期：2026-10-12（Asia/Shanghai）。
- 原许可：MIT。根目录 [LICENSE](LICENSE) 保留 Josh Townsend 的原版权及许可声明。

本项目基于上述固定源码派生，维护当前活跃的本地目录界面、CLI、通用规则、技能及项目模板。它提供自己的功能范围，不承诺上游全部功能；仓库不包含 `upstream/` 停用源码目录。

## 本仓库内容

示例数据仅包含 Hub 工具自身和一个虚构的 `demo-project`，用于演示项目登记、状态文档和短索引。使用者在自己的机器上初始化配置与登记；仓库不提供真实产品数据、工具适配器、账号凭据、机器配置或历史验证案例。

通用规则位于 `docs/hub/`，项目和工作空间模板位于 `templates/`。全局规则建议为可选合并片段，不是任何使用者的完整全局 AGENTS 文件。依赖由 `package.json` 和 `pnpm-lock.yaml` 记录，各依赖继续遵循其各自许可。

如需导出 ZIP，使用仓库内的导出脚本；它可为生成的分享包附带文件校验清单。Git clone 或下载源码后的部署不依赖该清单。
