# Pi Jev

Two optional, consent-gated TypeSafe Jev tools for the parent Pi agent, using OpenRouter, with one shared workflow skill.

| Resource | Role |
| --- | --- |
| [Pi Jev Router](extensions/pi-jev-router/README.md) | `jev_route_task`: advisory routing among available tools, skills, and investigation options |
| [Pi Jev Tools](extensions/pi-jev-tools/README.md) | `jev_rerank`: rank already-collected public web passages |
| [Shared skill](skills/pi-jev/README.md) | Select a useful available tool and interpret its bounded result |

**Experimental:** offline tests do not establish routing/ranking quality or cost savings. Neither tool executes a proposed route, grants authorization, searches for evidence, or silently calls a provider.

## Install from source

Review the source and clone this repository:

```bash
git clone https://github.com/MDGChamomile/pi-jev.git
cd pi-jev
```

Follow the [skill installation guide](skills/pi-jev/README.md) to copy the shared skill once and either extension or both. Existing kit installations should follow [MIGRATION.md](MIGRATION.md) first. A Pi reload/restart is required after changing installed resources.

Requirements: Node.js 22.22+, Pi with `ctx.modelRegistry.getProviderAuth()` support, a configured Pi `openrouter` provider, and an interactive UI or compatible RPC confirmation dialogs. Offline compatibility is pinned to Pi 0.85.0. No Python interpreter or TypeSafe SDK is needed at runtime.

Each tool reviews its entire immutable payload and asks for separate confirmation before a single paid request. Calls have no automatic retry and fail closed without approval UI. Read each guide for payload limits, data boundaries, cancellation behavior, per-token price ceilings, and the absence of a hard total-cost cap for the moving model alias.

The two extensions are independently loadable. The shared skill requires at least one, but does not install or execute either. Pi Subagent is not a runtime or development dependency; router preset names are advisory compatibility references only.

## Develop and verify

This is a source-distributed repository, not a published npm package. Its private root package owns only development dependencies. With Node.js 22.22+ and Python 3.10+:

```bash
npm ci --include=dev --ignore-scripts
npm run check
```

Installation accesses npm. Checks use mocked HTTP, synthetic credentials, isolated offline Pi loading/typechecking, the three source-copy installation combinations, and skill metadata/link validation. They do not make model/provider calls or load active Pi settings. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Design and license

Follow the [thin-procedure, firm-boundary principles](PRINCIPLE.md). Keep each extension independently inspectable; shared packaging does not require shared runtime code or automatic activation.

[MIT](LICENSE). Preserve bundled resource licenses when copying.
