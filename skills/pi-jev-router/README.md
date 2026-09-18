# Pi Jev Router Skill

A thin workflow for deciding when the parent Pi agent should call the companion consent-gated [`jev_route_task`](../../extensions/pi-jev-router/README.md) extension tool and how to interpret its advisory result.

The skill does not contact TypeSafe by itself. The extension performs the reviewed API call, validates the typed response, and returns route probabilities without executing tools, loading skills, or creating subagents.

## Requirements and installation

Copy both resources into the applicable Pi locations after reviewing their source and requirements:

```bash
mkdir -p ~/.pi/agent/extensions ~/.pi/agent/skills
cp -R live/extensions/pi-jev-router ~/.pi/agent/extensions/
cp -R live/skills/pi-jev-router ~/.pi/agent/skills/
```

The extension also needs an existing Python 3.10+ interpreter with `typesafe-sdk` installed, `TYPESAFE_API_KEY` inherited by Pi, and the `--jev-router-python` flag pointing to that interpreter. It does not install dependencies or read `.env` files.

Restart Pi or use `/reload`. The model may load this skill automatically when routing is genuinely ambiguous, or it can be invoked explicitly:

```text
/skill:pi-jev-router Decide whether this task should use a local or web subagent.
```

## Workflow boundary

The caller prepares a faithful **English** description of only the current task and any material English constraints. The extension adds active tool and discovered skill metadata, displays the complete payload, and requires separate approval before one paid Jev request.

The result is advice, not authority. Existing authorization, privacy, browser, tool, specialist-skill, and pi-subagent rules still determine what may happen. Failed or declined routing falls back to the normal parent workflow without an automatic retry.

Read [`SKILL.md`](SKILL.md) for the complete decision and interpretation procedure and the [extension guide](../../extensions/pi-jev-router/README.md) for setup, payload contents, limitations, tests, and evaluation guidance.

## License

[MIT](LICENSE). Keep the bundled license notice when copying or redistributing this skill.
