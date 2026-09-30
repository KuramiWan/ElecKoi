# @eleckoi/dsh-runtime

`@eleckoi/dsh-runtime` is ElecKoi's DSH Runtime Adapter Package（DSH 运行时适配包）。

## Ownership（职责）

- Own the DSH Desktop Web Host process, SessionController integration, notifications and session disposal.
- Implement the ElecKoi-owned Agent Runtime Port used by `src/main/modules/agent`.
- Keep Renderer, Preload, Gateway and product UI independent from DSH package APIs and versions.
- Build real ESM/CJS artifacts and declarations in `dist/`; consumers must use the package root export.

## Current capability（当前能力）

- Conversation-scoped text streaming.
- Event-sourced session persistence and restart resume.
- Deterministic cancellation and shutdown.
- Windows PowerShell, filesystem tools and background jobs.
- Local skills, goals, todos and automatic context compaction.
- Spawn/fork subagents, continuation controls and worker-thread workflows.
- Conversation-scoped character variables with Glob/Grep/Read/Patch tools, author Zod validation,
  and turn-atomic state commits.
- Exact, compatibility-batch DSH dependency versions.

The active conversation path starts the official Web profile through `desktopPluginHostChild.ts`.
`resources/dsh/desktop-agent.patch.yml` adds desktop Agent settings; DSH profile bundles add
ElecKoi's roleplay lifecycle and Tavily search provider. `resources/dsh/cordis.yml` remains an
SDK compatibility composition, not the active desktop conversation tree. The pinned upstream
commit, both composition roles and capability inventory are recorded in
`resources/dsh/runtime-manifest.json`. Renderer presentation consumes ElecKoi-owned typed stream
events, while the DSH Web Client loads the ElecKoi client plugins.

## Upstream update（上游更新）

1. Update all related `@deepseek-ai/dsh-*` packages as one exact-version compatibility batch.
2. Update `runtime-manifest.json` with the reviewed upstream commit and plugin inventory.
3. Run `pnpm check:dsh-versions` and `pnpm check:dsh-runtime`.
4. Run the real runtime handshake test, Electron native smoke check and production build.
5. Merge through a reviewed dependency-update PR; never track a floating upstream branch from the product directory.
