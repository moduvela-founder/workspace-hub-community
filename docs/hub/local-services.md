# 本地服务与接入

Hub 提供已登记 MCP/桥接服务的进程状态、显式启动/停止和接入索引。用户自行打开应用、连接扩展；Hub 不选择应用窗口、不执行工具 API，也不修改 Codex MCP 配置。

## 登记和本机配置

`catalog/services.json` 保存可共享的描述。下面只演示同一个虚构项目 `demo-project` 的服务登记格式，不预装或启动可运行服务；接入自己的服务时再按其工具指南确认参数：

```json
{
  "schemaVersion": 1,
  "services": [{
    "id": "demo-service",
    "title": "示例项目的本地服务（虚构）",
    "assetIds": ["demo-project"],
    "transport": "http-bridge",
    "guide": "docs/hub/local-services.md",
    "health": {
      "ports": [4178],
      "path": "/health",
      "identity": "demo-service"
    }
  }]
}
```

服务 ID 稳定且唯一，`assetIds` 引用现有资产。`guide` 是 Hub 内的相对 Markdown 路径；健康检查只访问已登记的本机端口和路径，验证响应 `service` 身份，不调用执行接口。`transport` 可为 `http-bridge`、`streamable-http` 或 `stdio`。标准 stdio MCP 由 Codex 客户端托管，可登记阅读入口，不包装为常驻后台进程。

实际可执行路径在 Git 忽略的 `.local/service-profiles.json`：

```json
{
  "schemaVersion": 1,
  "profiles": {
    "demo-service": {
      "command": "ABSOLUTE_EXECUTABLE_PATH",
      "args": ["ABSOLUTE_SERVER_SCRIPT_PATH"],
      "cwd": "ABSOLUTE_WORKING_DIRECTORY"
    }
  }
}
```

占位符须替换为本机绝对路径；`cwd` 必须位于本机已配置的允许根内。配置文件由当前用户拥有，权限为 `600`，不支持额外 `env` 字段；此文件不进入目录或内容索引。登记公开描述不等于安装成功；没有有效本机配置时保留不可启动状态。新增服务先核对原始工具说明、来源许可、独立进程启动方式和安全退出方式，不从网页请求或索引材料提取任意命令执行。

## 页面和进程操作

侧栏“MCP 服务”展示已关联的工具/技能卡，卡片和详情复用同一服务登记。服务运行状态独立于项目开发阶段，不增加资产类型，不为使用同一服务的产品复制服务。

在 Hub 根执行：

```sh
node scripts/hub-services.mjs status
node scripts/hub-services.mjs status --id demo-service
node scripts/hub-services.mjs start --id demo-service
node scripts/hub-services.mjs stop --id demo-service
```

命令均输出 JSON；`status` 省略 `--id` 时返回全部服务，`start`/`stop` 必须指定 ID，返回该服务的状态。`status` 只读；启停在当前任务或用户按钮操作已授权时执行。

macOS 使用当前用户的 `launchctl` 管理 Hub 自己登记的进程，固定标签为 `com.moduvela.workspace-hub.service.ID`，plist 和日志留在 Git 忽略的 `.local/services/ID/`。仅注册当前 GUI 会话，显式启动即运行；不设置登录自启，不使用 `KeepAlive` 自动复活。Hub 重启不影响独立服务进程。检测到外部已运行服务时仅展示，不收编或停止它。停止共享服务会影响正在使用它的任务。

更换可执行路径、参数或工作目录时，先用旧 profile 停止服务。确认该服务已停止、生成的 `.local/services/ID/service.plist` 确实属于当前 Hub 后，将这个生成文件移到同目录的备份名，再更新私有 profile、重新启动生成新文件；保留备份便于恢复。Node 升级导致实际二进制路径变化也按此步骤处理。若已改 profile 而原进程仍在运行，先恢复旧 profile 完成停止；不同配置的启动文件或进程不会被自动覆盖、接管。

正常启停自动清理操作锁。异常退出留下的完整、私有锁，仅在原 PID 明确不存在且文件归属未变时恢复；活跃、损坏或无法确认的锁继续提示冲突，管理员按本机操作证据处理，页面不会猜测并删除它。

HTTP `GET /api/hub/services` 返回状态；`POST /api/hub/services` 仅接受 `{id, action: "start" | "stop"}`。接口限本机同源，不接受命令、参数、工作目录或连接目标。读状态不会自动启动、连接应用或改变项目文件。

响应格式为 `{schemaVersion: 1, services: [...]}`，每项含登记字段及 `state`、`managed`、`canStart`、`canStop`、`health`，可带实时 `endpoint` 或错误说明。`state` 为 `running`、`stopped`、`unknown` 或 `unavailable`，按钮按实际可操作标志显示；不把探测失败显示成已停止。

进程存在、桥接健康和应用连接是不同事实。`health` 为 `ready`、`not-ready` 或 `unknown`；健康探测只核对服务身份，不输出应用窗口信息。桥接健康检查通过也不代表应用已连接，连接信息仍按工具指南查询。

## 给新会话的索引

复制现有三行短引用：稳定资产 ID、名称和实际索引位置；可附一句任务目的，不复制本机启动配置或过期端口。新会话运行 `hub.mjs resolve --id ID`，读取适用项目规则和返回的服务 `guide`，需要当前端点时运行 `statusCommand`。

`resolve.services` 包含资产自身及其 `uses` 能力关联的服务入口。解析只读静态登记，不探测进程、不执行接入；复制索引也不代表服务已注入会话。HTTP 桥接按原始技能调用，标准 MCP 按其 Codex 客户端接入方式使用。无需把各服务的详细配置加入全局 AGENTS。
