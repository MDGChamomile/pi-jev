# Repository migration

Pi Jev originates in [Pi Agent Kit](https://github.com/MDGChamomile/pi-agent-kit). Both extensions and their shared skill move together, while installation remains selective. The repository retains filtered history for both extension directories, the shared skill and its former `pi-jev-router` predecessor, the shared skill validator, license, and design principles. The old `live/extensions/` and `live/skills/` prefixes become `extensions/` and `skills/`. Commit IDs change with the filtered trees; kit tags are not imported as Jev product releases.

Historical removed Python adapters remain in Git history, not in the current installation. Original kit releases and evidence links still describe their original code and transport. In particular, the bundled demonstration is not evidence of current OpenRouter compatibility or measured ranking quality.

## Existing source-copy or symlink installations

1. Inspect the installed `pi-jev` skill and whichever extension directories are enabled. Check for local edits, old symlinks, and the former `pi-jev-router` skill.
2. Prepare the new checkout and run its offline checks before changing installed resources.
3. Back up local modifications. Replace only the reviewed skill/extension targets; do not overlay old directories or load copies from both checkouts. Keep one shared skill and either extension or both, according to the existing selection.
4. Remove an obsolete router-only skill only after confirming it is the superseded copy. Preserve unrelated skills, credentials, and environments.
5. Reload or restart Pi and confirm the expected tool names and a single shared skill. If loading fails, restore the previous reviewed copies/links and reload.

The repository move itself did not change tool names or approval/provider behavior. Starting with v0.2.0, however, the router tool is named `jev_task_router` instead of `jev_route_task`. Update prompts, tool allowlists, and other references to the old name; replace the installed router extension and shared skill together, then reload Pi. The reranker remains `jev_rerank`. No migration step needs a paid Jev call. The [skill guide](skills/pi-jev/README.md) separately describes migration from the historical direct TypeSafe/Python setup.

## Switching to the single Git package

Keep the development clone separate from the live `~/.pi/agent` environment. Do not install the mutable development path into the live environment.

1. Validate the checkout with `npm run check`, then publish the reviewed changes to the default branch through the repository's review process. A new tag or GitHub Release is not required for an unpinned installation.
2. Inspect existing Jev extension and skill copies, symlinks, and configured paths for local changes. Back up the reviewed resources and relevant configuration outside Pi's resource-discovery directories.
3. With explicit approval for live changes, retire only the old Jev resource copies/links and configured paths so they cannot load alongside the package. Preserve unrelated resources and credentials.
4. Run `pi install git:github.com/MDGChamomile/pi-jev`. This installs both extensions and the shared skill as one package. Use `pi config` to preserve any previous selective loading.
5. Restart Pi and confirm `jev_task_router`, `jev_rerank` (or the selected subset), and exactly one `pi-jev` skill. No paid provider call is needed.
6. For later updates, run `pi update --extension git:github.com/MDGChamomile/pi-jev`, then restart or `/reload`. With no ref, updates follow the remote default branch, not the local development clone.

If migration fails, remove the new package declaration with `pi remove git:github.com/MDGChamomile/pi-jev`, restore the backed-up Jev resources/configuration without overwriting unrelated changes, and restart. Do not restore source copies while leaving the package enabled.

## Development and distribution

The independent repository release line starts at `0.1.0`, recorded in the private development manifest and lockfile. Git tags and GitHub Releases establish source releases; the private manifest does not publish an npm package.

The root private package owns the pinned Pi/TypeScript development environment. `npm ci --include=dev --ignore-scripts` and `npm run check` no longer depend on a pi-subagent checkout. The root `pi` manifest exposes both extensions and the shared skill as one Git-installable Pi package. Independent source-copy installation remains supported; npm publication is not required.

Preparing a new repository does not update active Pi settings or remove old kit sources. Keep the old checkout available until the installed selection has been verified.
