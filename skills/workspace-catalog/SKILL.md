---
name: workspace-catalog
description: Register Workspace Hub assets, maintain project documents, agree delivery/UI conventions, or find shared capabilities. Analysis and reviews stay read-only.
---

# Workspace Catalog

Locate the Hub root from this SKILL.md's real path (follow an installation symlink); it is two directories above the skill folder. Run the CLI there as `node scripts/hub.mjs ...`. Owning project instructions and evidence remain authoritative. Hub lookup and reference reading use the relevant consumer guidance; read applicable Hub instructions before modifying Hub-owned content or executing Hub-owned capabilities. Looking up a reference does not make the Hub application's build commands apply to the consuming project.

At the first applicable task, missing context, or the next managed-document write, check `rules --summary --json` (optionally `--since HASH`). Read relevant guidance on first use or missing context even when unchanged. When changed, use `rules --json` to compare any retained per-file hashes; without a prior file list, reread current relevant guidance. Reuse unchanged text only while retained in context. Fingerprints do not establish live project/device state.

Use a known task-specific entry directly; do not reread every router, skill or linked source merely to reach it.

| Task | Read |
| --- | --- |
| Adopt or adjust a project's shared-rule entry | [Project rules](../../docs/hub/project-rules.md) |
| Agree project/feature delivery scope or refocus the current mainline | [DEMO/productization workflow](../../docs/hub/delivery-workflow.md) |
| Adopt or review UI information, copy, layout and viewport acceptance conventions | [UI delivery guide](../../docs/hub/ui-delivery.md) |
| Register/classify assets or relate repositories/capabilities | [Asset contract](../../docs/hub/asset-model.md) |
| Register local MCP/bridge processes, explicitly start/stop them, or hand off connection information | [Local-service contract](../../docs/hub/local-services.md), then the registered tool guide |
| Initialize documents or update changed facts after implementation | [Document contract](../../docs/hub/document-contract.md) |
| First-time old-project or batch organization | [Onboarding](../../docs/hub/onboarding.md) |
| Register/query role, skill or reference members and body excerpts | [Collection contract](../../docs/hub/knowledge-collections.md) |
| Select/migrate storage or build/release outputs | [Storage/output contract](../../docs/hub/storage-and-outputs.md), then the target machine's environment procedure |

Use `resolve --id ID` for `workspace-hub:ID[#MEMBER]`; `search --query TEXT` finds assets, `members --id ID --query TEXT` finds member metadata, and `content --id ID --query TEXT` returns bounded Markdown excerpts. `reference --id ID` creates a short handoff with Hub location and name. Resolution is navigation: read owning instructions and sources relevant to the selected source and intended action, not all related `instructions` paths. Source roles do not authorize installation, external actions or device access.

For a resolved service, read its guide and run its `statusCommand` only when current process/endpoint information is needed. Stable references do not embed live ports, start services, configure Codex MCP or inject tools into the receiving session. Start/stop requires the current task's authorization and a local registered profile; application connection and actual tool operations remain separate. Do not replace client-managed stdio MCP servers with background processes.

Preview `init` before applying within the authorized main directory; it creates only absent standard files and does not register the asset or upgrade existing AGENTS. For old projects with alternative status/manual documents, map those first and merge only missing entries instead of applying the four-file scaffold. Update existing owning documents and only facts affected by the task. Preserve original start dates; unknown old-project dates remain null. Distinguish build/simulation, physical validation, handoff and publication.

After registry edits run `validate`. Do not index credentials, raw chats, backups, build outputs or private machine profiles. Reading/scanning is not permission to write projects, publish, push or operate devices.
