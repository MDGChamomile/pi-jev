# Pi Jev Skill

A shared workflow that lets the parent Pi agent select among available consent-gated TypeSafe Jev tools without requiring the user to request Jev explicitly.

The skill currently covers:

- [`jev_route_task`](../../extensions/pi-jev-router/README.md) for genuinely ambiguous task, tool, skill, browser, and pi-subagent routing; and
- [`jev_rerank`](../../extensions/pi-jev-tools/README.md) for relevance ranking of already-collected public web passages.

The skill does not contact TypeSafe. Each extension validates its own input, displays the complete payload, requires separate approval, performs at most one paid request per invocation, and returns advisory output.

## Requirements and installation

Copy the shared skill and whichever Jev extensions you intend to expose:

```bash
mkdir -p ~/.pi/agent/extensions ~/.pi/agent/skills
cp -R live/skills/pi-jev ~/.pi/agent/skills/
cp -R live/extensions/pi-jev-router ~/.pi/agent/extensions/   # optional
cp -R live/extensions/pi-jev-tools ~/.pi/agent/extensions/    # optional
```

At least one extension is required. Each extension needs an existing Python 3.10+ interpreter with `typesafe-sdk` installed, `TYPESAFE_API_KEY` inherited by Pi, and its documented interpreter flag. Neither extension installs dependencies or reads `.env` files.

This shared skill replaces the former `pi-jev-router` skill. When upgrading a copied installation, review and remove the old directory so both workflows are not discovered:

```bash
rm -R ~/.pi/agent/skills/pi-jev-router
```

Restart Pi or use `/reload`. The model may load this skill automatically when an available Jev tool would materially help, or it can be invoked explicitly:

```text
/skill:pi-jev Decide whether an available Jev tool would help with this task.
```

Read [`SKILL.md`](SKILL.md) for the selection and interpretation workflow. Read each extension guide for its setup, payload, limits, data boundary, tests, and evaluation guidance.

## Boundary

Jev output is advice, not authority. Existing authorization, privacy, browser, tool, specialist-skill, and pi-subagent rules still determine what may happen. Failed or declined calls fall back to the normal workflow without automatic retries.

## License

[MIT](LICENSE). Keep the bundled license notice when copying or redistributing this skill.
