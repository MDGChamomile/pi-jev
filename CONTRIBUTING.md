# Contributing

Follow [PRINCIPLE.md](PRINCIPLE.md): keep procedures thin and boundaries firm. Explain the observed problem and expected benefit. Repository separation is not evidence for routing/ranking quality, and similar implementations alone do not justify a shared runtime library.

## Pull requests

Create your contribution branch from the latest `updates` branch, and select
`updates` as the base branch when opening a pull request. GitHub may suggest
`main` because it is the repository's default branch; please change the base
to `updates` before submitting.

Contributions are reviewed and merged into `updates`. Maintainers open pull
requests from `updates` to `main` only when preparing a release. If you
accidentally target `main`, the base can be changed to `updates`; the resulting
diff and checks should then be reviewed again.

## Development

With Node.js 22.22+ and Python 3.10+, from the repository root:

```bash
npm ci --include=dev --ignore-scripts
npm run check
```

The private root package and lockfile own pinned Pi 0.85.0/TypeScript development dependencies. No other checkout is required. Dependency installation accesses npm; runtime use of copied extensions does not need this development tree.

- `npm test`: both extensions' mocked-HTTP regression tests with synthetic keys.
- `npm run check:pi`: isolated offline type/load checks for each extension, then router-only, reranker-only, and both source-copy installations with exactly one shared skill; root-package discovery also checks both tools, selective extension loading, skill-only loading, and disabling the skill.
- `npm run check:skills`: validator unit tests and skill frontmatter/relative-link validation.

The checker subprocesses use a temporary HOME, no inherited credentials or active Pi configuration, and `PI_OFFLINE=1`. Package discovery uses the local root manifest; it does not test a remote Git clone/install or network dependency resolution. No model session or provider request is created. README links still need review; skill validation is not a full YAML or semantic checker.

Keep source in `extensions/pi-jev-router/`, `extensions/pi-jev-tools/`, and `skills/pi-jev/`. Preserve the independent registration and existing consent, privacy, cancellation, no-retry, and sanitized-fallback contracts. Add focused regression tests for behavior changes. Review shared skill guidance when changing tool contracts.

Live OpenRouter tests and evaluations need separate authorization for provider/model, request count, cost, and disclosed data. Do not infer live compatibility or quality from mocked tests. Do not install into an active Pi environment as a verification shortcut.

The repository has no npm release workflow. Keep resource licenses when copying and do not commit credentials, private session data, or local configuration. Contributions are licensed under [MIT](LICENSE).
