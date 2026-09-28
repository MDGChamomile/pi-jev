# Agent Guide

Before making changes, consult the upstream harness principles linked from [PRINCIPLE.md](PRINCIPLE.md) and read [CONTRIBUTING.md](CONTRIBUTING.md). The local PRINCIPLE.md is a pointer, not a second copy. If the upstream document is unavailable, keep procedures thin and follow the local safety boundaries below; do not infer that the missing document relaxes them.

## Scope

This repository develops an experimental, opt-in purposeful reader plus legacy advisory TypeSafe Jev routing and public-passage reranking tools. Keep each extension independently installable; do not silently change an active Pi installation or the legacy root package's resource selection:

- `extensions/pi-jev-context/`: bounded purposeful source reading, optional Jev ranking, explicit activation.

Preserve the legacy resources:

- `extensions/pi-jev-router/`: task routing.
- `extensions/pi-jev-tools/`: public-passage reranking.
- `skills/pi-jev/`: shared usage guidance.

## Boundaries

- Preserve legacy tools' per-request consent and full-payload review. The purposeful reader uses an explicitly authorized bounded activation grant instead: approved local paths and external-transmission scope, selected provider, session-local request/input quotas, and revocation. Grants must not survive session changes, extension reload, or process restart; never read or reuse the former project-persistent grants. Credentials alone do not authorize transmission; never silently expand or replenish a grant.
- Preserve authentication, cancellation, single-call/no-retry, bounded-output, and sanitized-fallback behavior for every extension. Local access authorization and external disclosure permission are separate. New file access must not assume other tools' permission hooks are inherited.
- Jev provides selection advice, not authorization, execution, or source verification.
- Never send or commit credentials, private session data, authenticated content, signed URLs, or unauthorized data. The reader may transmit only explicitly authorized project source excerpts and the authorized goal; legacy tools still exclude local/private source content. Filename and content filtering is defense in depth, not complete DLP.
- Live provider calls (OpenRouter or direct TypeSafe) require separate explicit authorization for the provider/model, maximum request count, maximum spend, and disclosed data.
- Do not install into an active Pi environment as a testing shortcut.

## Changes and verification

- When changing a tool contract, review its extension README and `skills/pi-jev/SKILL.md` together. The legacy skill is not a prerequisite or router for purposeful reading.
- Evaluate candidate discovery, selected-evidence preservation, ordinary-request tool adoption, and whole-task outcomes separately. Offline fixtures and mocked rankings are not live Jev quality or speed evidence.
- Preserve names, numbers, negation, uncertainty, scope, and plan-versus-execution distinctions in semantic inputs.
- Add focused regression tests for behavior changes. Keep documentation clear about experimental status and limitations.
- Run relevant narrow checks while iterating; run `npm run check` for shared-contract changes or repository-wide verification.
- The offline suite uses mocked HTTP and isolated Pi checks. Passing it does not establish live provider compatibility or routing/ranking quality.
