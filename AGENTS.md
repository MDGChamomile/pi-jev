# Agent Guide

Before making changes, consult the upstream harness principles linked from [PRINCIPLE.md](PRINCIPLE.md) and read [CONTRIBUTING.md](CONTRIBUTING.md). The local PRINCIPLE.md is a pointer, not a second copy. If the upstream document is unavailable, keep procedures thin and follow the local safety boundaries below; do not infer that the missing document relaxes them.

## Scope

This repository develops experimental Pi extensions for advisory TypeSafe Jev routing and public-passage reranking, plus a shared skill. Keep all three independently installable:

- `extensions/pi-jev-router/`: task routing.
- `extensions/pi-jev-tools/`: public-passage reranking.
- `skills/pi-jev/`: shared usage guidance.

## Boundaries

- Preserve consent, full-payload review, authentication, cancellation, single-call/no-retry, bounded-output, and sanitized-fallback behavior.
- Jev provides advice, not authorization, execution, or source verification.
- Never send or commit credentials, private session data, authenticated content, signed URLs, or unauthorized data.
- Live provider calls (OpenRouter or direct TypeSafe) require separate explicit authorization for the provider/model, maximum request count, maximum spend, and disclosed data.
- Do not install into an active Pi environment as a testing shortcut.

## Changes and verification

- When changing a tool contract, review its extension README and `skills/pi-jev/SKILL.md` together.
- Preserve names, numbers, negation, uncertainty, scope, and plan-versus-execution distinctions in semantic inputs.
- Add focused regression tests for behavior changes. Keep documentation clear about experimental status and limitations.
- Run relevant narrow checks while iterating; run `npm run check` for shared-contract changes or repository-wide verification.
- The offline suite uses mocked HTTP and isolated Pi checks. Passing it does not establish live provider compatibility or routing/ranking quality.
