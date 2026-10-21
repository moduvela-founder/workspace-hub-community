# 资产与仓库契约

## 类型和状态分开

七种类型平行展示：`product` 产品；`tool` 独立使用的工具；`framework` 被其他工程集成的框架/组件；`workflow` 发布/工程流程；`skill` 可复用技能和 Agent 角色集合；`ai` AI 生成作品；`reference` 参考资料。按当前用途分类，标签补充用途；意向是阶段，不是类型。技能与角色源码收录不等于已安装或已启用。

- `stage`：`intention` 意向、`research` 调研、`design` 设计、`implementation` 实现、`validation` 验证、`delivered` 交付、`unknown` 待确认。
- `activity`：`active` 推进中、`blocked` 阻塞、`paused` 暂缓、`maintenance` 维护中、`archived` 已归档、`unknown` 待确认。
- `readiness`：`unimplemented` 未实现、`unverified` 待验证、`partial` 部分可用、`verified` 已验证可用、`unknown` 待确认。
- `priority`：可选 `high` / `normal` / `low`。意向条目保留，但不因此成为依赖。

这些字段没有自动推导关系。代码较多不等于可用，长期未修改不等于失效。`verified` 必须限定验证范围并链接证据；软件构建通过不代表产品实测通过。

## catalog/assets.json

根对象为 `{schemaVersion: 1, assets: [], repositories: []}`。ID 是稳定的短标识，不随目录改名；唯一性分别在资产、仓库集合内保证。

资产必需字段：`id`、`kind`、`title`、`workspace`、`summary`、`stage`、`tags` 字符串数组、`repositoryIds` 仓库 ID 数组、`uses` 关联资产 ID 数组、`sources` 来源数组。可选字段：`goal`、`activity`、`readiness`、`priority`、`ownerPath`、`entrypoint`、`statusFile`、`manualStepsFile`、`startedAt`、`confirmedAt`。

`sources` 每项为 `{path?: string, note: string, checkedAt?: string}`。只保存简短事实及文档入口；用户陈述无已知路径时省略 `path` 并明确其来源。`checkedAt` 是本次阅读日期；`confirmedAt` 是状态经依据确认的日期，未知为 `null`，不能用扫描时间替代。`ownerPath` 等路径未知同样用 `null`。

`startedAt` 是真实项目/资产起始日期，使用 ISO 日期或 `null`；已有日期保留，旧项目未知时填写 `null`。不以登记日期、Git 首次提交或文件修改时间猜测起点；只有明确依据才补齐。初始化创建不存在的新目录时填写当天日期；已有目录补文档默认留空，待明确依据补齐，不能借此改写既有项目历史。

`workspace` 是展示分组（如“项目组”“共享资源”），不是目录权限。涉及的绝对本机路径须位于 `hub.config.json` 的允许根下。外部工具可通过根下文档指向，不能为了读取整个系统而放宽根。含凭据的 URL、秘密文件、原始聊天、备份和构建产物不进入目录。

仓库记录为 `{id, title, path, checkouts?: [{path, role}], remoteHint?: string}`。`path` 为主入口，`checkouts` 可登记 worktree/副本并说明角色；`remoteHint` 只可保存去除凭据的非敏感提示。发现目录并不能证明远端、账号和当前连接正常。

## 关联原则

一个产品关联多个仓库，一个仓库可以被多个资产引用。共享仓库保留一份主入口；不同分支的并行开发使用 worktree 并登记其角色，不创建第二个产品。同版本、单一写入者可共用工作目录；路径引用和符号链接不隔离修改。

产品状态由产品主目录维护，仓库不能复制同一套产品状态。工具、框架、流程可以有自己的生命周期和状态；其原目录无需为了登记搬家。框架候选链接已有实现及适用边界，未经独立验证不得宣称已提取通用框架。

芯片适配是通用流程内部的操作文档，不因型号、仓库、实验或验证批次另建产品卡。有独立目标、型号和状态的产品保留独立卡；产品用 `uses` 关联通用能力，能力详情从这些关联反向显示使用方。适配文档可以链接产品卡，产品身份和板级参数仍以原产品配置为准。

展示读取 `statusFile` 的受控 YAML 字段并保留目录来源，失败或缺失时标明；目录初始摘要只是基线，不能覆盖项目文档结论。关系冲突、来源过期或未知状态显式保留。

在线来源的 `sources.path` 可以是无凭据、无查询参数的 HTTP(S) 文档链接，仅展示链接、不抓取网络。远端主机目录写入摘要或来源说明，不伪装为 Mac 本机入口。归档记录可继续展示，原始材料保留，是否恢复是独立操作。

## 查询与短引用

网页详情链接为 `/hub?asset=<asset-id>`，用于定位和高亮已登记资产。给新会话交接入口时使用 `workspace-hub:<asset-id>`，附实际 Hub 根目录与名称；名称便于阅读，ID 才是解析依据。引用不携带历史长摘要。

只读 CLI 使用共享索引：`resolve --id ID` 查询资产、关联仓库、来源及应读项目 AGENTS 入口；`search --query TEXT` 找入口；`reference --id ID` 生成短引用。解析结果是阅读导航，不是已读取规则、当前在线状态或设备操作授权；同机新会话按需读取对应项目规则与来源。

`instructions` 汇总拥有项目、关联仓库/能力和选中成员的候选规则路径；按选中来源及本次实际动作读取适用内容，未使用的关联能力不构成全量必读。目标项目自己的适用指令始终有效。只读查询/使用共享说明按任务读取消费规范，不继承 Hub 应用的开发命令；修改 Hub 拥有的内容或执行其能力时，再读适用的 Hub 指令和操作指南。

本地服务登记在独立的 `catalog/services.json`。一个服务可关联多个资产；产品通过已有 `uses` 关联服务所属工具/技能，避免重复创建进程或产品卡。“MCP 服务”是展示视图，不是第八种资产类型；运行/停止状态不改写 `stage`、`activity` 或 `readiness`。`resolve` 的 `services` 给出服务 ID、接入指南和只读状态命令，不读取私有启动配置或探测进程。登记与启停边界见[本地服务契约](local-services.md)。

资料包可登记成员索引而不增加一级卡：`members --id ID` 查成员名称/说明，`content --id ID --query TEXT` 查已批准范围的Markdown正文；`workspace-hub:ID#MEMBER` 指向一个成员，resolve仍返回原文件/规则指针，不把角色全文作为指令注入。登记、来源和读取限制见[资料包契约](knowledge-collections.md)。

## 本机展示偏好

布局写入口为 `/api/hub/layout`，只保存资产 ID 顺序到被 Git 忽略的 `.local/view-preferences.json`，不修改目录、项目状态或来源。本地服务的显式进程操作使用独立的 `/api/hub/services`，不写布局或项目文档。资产身份以登记 ID 为准，排序不能制造新资产或改变分类。分类和关注项都显示当前范围/全局数量：分类分子随工作空间、搜索与关注条件变化，分母保持该分类全局数量；关注分子随分类、工作空间与搜索变化，分母保持该关注项全局数量。服务视图按关联资产去重计数，尚未读取服务登记时显示未知。切换项的分子与切换后的列表数量一致，标注“总”的统计保持全局口径。
