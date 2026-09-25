# Pi Jev Skill

A shared workflow that lets the parent Pi agent select among available consent-gated TypeSafe Jev tools, called through OpenRouter, without requiring the user to request Jev explicitly.

The skill currently covers:

- [`jev_task_router`](../../extensions/pi-jev-router/README.md) before choosing among two or more unresolved, feasible research, comparison, or review workflows, or for explicit routing evaluation; and
- [`jev_rerank`](../../extensions/pi-jev-tools/README.md) after collecting multiple usable public passages, before reading all sources in depth, when reading order remains open.

Use the applicable tool once, subject to data and consent boundaries, rather than requiring a second speculative estimate of a large benefit. Skip trivial tasks, user-specified or settled routes, and sufficient or fully reviewed evidence. Several available tools alone do not justify routing.

The skill does not contact a provider. Each extension validates its own input, displays the complete payload, requires separate approval, resolves Pi's existing OpenRouter authentication, performs at most one paid request per invocation, and returns advisory output.

## Requirements and installation

From this repository's root, copy the shared skill once and whichever Jev extensions you intend to expose. For an existing kit installation, first review the [migration guide](https://github.com/MDGChamomile/pi-jev/blob/main/MIGRATION.md) rather than overlaying existing directories.

```bash
mkdir -p ~/.pi/agent/extensions ~/.pi/agent/skills
cp -R skills/pi-jev ~/.pi/agent/skills/
cp -R extensions/pi-jev-router ~/.pi/agent/extensions/   # optional
cp -R extensions/pi-jev-tools ~/.pi/agent/extensions/    # optional
```

At least one extension is required. Each extension needs a configured Pi `openrouter` provider and a compatible approval UI. No Python interpreter, TypeSafe SDK, Jev-specific flag, or separate TypeSafe key is needed. The extensions do not install dependencies or read credential files themselves.

This shared skill replaces the former `pi-jev-router` skill. When upgrading a copied installation, review and remove the old directory so both workflows are not discovered:

```bash
rm -R ~/.pi/agent/skills/pi-jev-router
```

### Migrating from the direct TypeSafe setup

Replace copied extension directories cleanly rather than overlaying them, so removed Python adapters and tests do not linger. Remove the obsolete `--jev-python` and `--jev-router-python` arguments from Pi launchers; the new extensions register neither flag. If no other software uses them, the separate `TYPESAFE_API_KEY`, `typesafe-sdk` environment, and Jev-only virtual environment can also be retired. Do not remove shared credentials or environments without checking their other consumers.

Restart Pi or use `/reload`. The model may load this skill automatically at these decision points, or it can be invoked explicitly:

```text
/skill:pi-jev Decide whether an available Jev tool would help with this task.
```

Read [`SKILL.md`](SKILL.md) for the selection and interpretation workflow. Read each extension guide for its setup, payload, limits, data boundary, tests, and evaluation guidance.

## Boundary

Jev output is advice, not authority. Existing authorization, privacy, browser, tool, specialist-skill, and pi-subagent rules still determine what may happen. Failed or declined calls fall back to the normal workflow without automatic retries.

## License

[MIT](LICENSE). Keep the bundled license notice when copying or redistributing this skill.
