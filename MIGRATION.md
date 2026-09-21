# Repository migration

Pi Jev originates in [Pi Agent Kit](https://github.com/MDGChamomile/pi-agent-kit). Both extensions and their shared skill move together, while installation remains selective. The repository retains filtered history for both extension directories, the shared skill and its former `pi-jev-router` predecessor, the shared skill validator, license, and design principles. The old `live/extensions/` and `live/skills/` prefixes become `extensions/` and `skills/`. Commit IDs change with the filtered trees; kit tags are not imported as Jev product releases.

Historical removed Python adapters remain in Git history, not in the current installation. Original kit releases and evidence links still describe their original code and transport. In particular, the bundled demonstration is not evidence of current OpenRouter compatibility or measured ranking quality.

## Existing source-copy or symlink installations

1. Inspect the installed `pi-jev` skill and whichever extension directories are enabled. Check for local edits, old symlinks, and the former `pi-jev-router` skill.
2. Prepare the new checkout and run its offline checks before changing installed resources.
3. Back up local modifications. Replace only the reviewed skill/extension targets; do not overlay old directories or load copies from both checkouts. Keep one shared skill and either extension or both, according to the existing selection.
4. Remove an obsolete router-only skill only after confirming it is the superseded copy. Preserve unrelated skills, credentials, and environments.
5. Reload or restart Pi and confirm the expected tool names and a single shared skill. If loading fails, restore the previous reviewed copies/links and reload.

The tool names and approval/provider behavior do not change with the repository move. No migration step needs a paid Jev call. The [skill guide](skills/pi-jev/README.md) separately describes migration from the historical direct TypeSafe/Python setup.

## Development and distribution

The independent repository release line starts at `0.1.0`, recorded in the private development manifest and lockfile. Git tags and GitHub Releases establish source releases; the private manifest does not publish an npm package.

The root private package owns the pinned Pi/TypeScript development environment. `npm ci --include=dev --ignore-scripts` and `npm run check` no longer depend on a pi-subagent checkout. This is not an npm publication or a promise of Git-package installation; source-copy installation remains the documented distribution method.

Preparing a new repository does not update active Pi settings or remove old kit sources. Keep the old checkout available until the installed selection has been verified.
