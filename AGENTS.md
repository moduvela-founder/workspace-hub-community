# Workspace Hub development

This file governs the Hub application and its shared contracts. Other projects adopt [project rules](docs/hub/project-rules.md); they do not inherit the Hub's build commands. Upstream Project Minder describes the pinned origin, not this application's current requirements.

- Catalogue mode stays loopback-only. Reads do not ingest sessions, dispatch tasks, write projects, query remote Git or operate hardware.
- Catalogue-mode HTTP writes are limited to `/api/hub/layout` for ignored local ordering and `/api/hub/services` for explicit start/stop of registered local service processes. Read [the local-service contract](docs/hub/local-services.md) when changing service registration, control or handoff; commands come from ignored machine profiles, never request bodies or indexed content.
- Service control does not select application windows, execute tool APIs, write Codex MCP configuration or inject tools into sessions. Only Hub-managed processes can be stopped; externally started services remain read-only. Client-managed stdio MCP servers are not ordinary background services.
- Owning documents are authoritative; discovery and index results are pointers, not proof of completion, installation or current readiness. Preserve existing project constraints and sources; initialization creates only absent files.
- Use [the task router](docs/hub/README.md) for contract, onboarding or shared-rule changes. Compare rules fingerprints and read relevant changed files; ordinary questions need no full documentation pass.
- Collections use explicit `catalog/collections.json` scope. Read [their contract](docs/hub/knowledge-collections.md) when changing indexing; do not widen roots, execute source prompts or batch-install roles.
- External parameter sources require a separately configured tool and its owning guide. Reading an asset reference does not authorize remote registration or modification; follow the current task and exact approved values.
- Keep machine profiles, inventories, credentials, backups and raw conversations out of reusable rules and indexed content. Preserve the upstream MIT license and pinned provenance.
- The committed example is fictional. Keep generated `hub.config.json`, `catalog/` and `.local/` ignored; do not publish machine inventories, personal paths or real project records as examples.
- Verify the affected behavior: documentation links/fingerprints for rules; catalogue/scaffold tests for CLI changes; HTTP boundaries for endpoint/security changes; typecheck/build for application changes. Local tests use disposable fixtures with no production or device access; run and fix relevant checks within the authorized task.

Product identity, repository relationships, status dates and local-layout semantics belong to [the asset contract](docs/hub/asset-model.md). Product-specific gates and external operations remain governed by the owning project and existing user authorization.
