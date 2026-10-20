# Changelog

## [1.11.6](https://github.com/atralice/skillLib/compare/v1.11.5...v1.11.6) (2026-10-20)


### Bug Fixes

* a result gets a third of the screen (a group move's reasons fit at 80x24) ([#113](https://github.com/atralice/skillLib/issues/113)) ([b7e970a](https://github.com/atralice/skillLib/commit/b7e970aabf6d28a82843f86e382fe4569b4b41e5))
* the tab bar fits narrow terminals; results get room to say why ([#111](https://github.com/atralice/skillLib/issues/111)) ([d4c2a1b](https://github.com/atralice/skillLib/commit/d4c2a1b253f1d47e6a8e96cb5e75c9b121813f7f))

## [1.11.5](https://github.com/atralice/skillLib/compare/v1.11.4...v1.11.5) (2026-10-19)

Fixes from a final full regression run and a code review after 1.11.4.

### Fixes
* Two committed copies of a skill that differ: doctor's "Keep the … copy" works again (in 1.11.4 it could change nothing with Claude Code, Codex or Cursor alone), and says git will see it; `tidy --keep` does the same. A keep that would change nothing is never offered.
* The app's "unused" hint counts a plugin's copy (`/plugin:skill`) for the skill, as doctor does.
* `global move` no longer tells you to pass `--force`, which `global` doesn't take: it says what to change in the repo instead.
* "Replace with your copies" keeps your own global copy when it differs from the plugin's, as doctor's plugin removal does.
* A transcript that's a looping link or a pipe is skipped: `usage`, `doctor` and `status` no longer fail or hang on one.
* A skill removed outside the app since it loaded says so, instead of an error about `undefined`.
* The tidy backup path printed follows `SKILLLIB_HOME`; the README says doctor copies a plugin's other skills, not all of them.

## [1.11.4](https://github.com/atralice/skillLib/compare/v1.11.3...v1.11.4) (2026-10-19)

A reliability release from many rounds of review. Nothing new to learn; skilllib is now much harder to make lose a skill, leave a change half done, or write somewhere it shouldn't.

### Safer global skills
* `global move`, doctor's "Stop loading it globally" and the app's Delete / Move to repos never take a global skill away from an agent that still needs it in any repo you have, including a repo that reaches it through a link, a skills folder linked to a shared folder of yours (`~/devskills`), or a monorepo package that pins it. When one would, skilllib refuses and says what to change, or that `skilllib global keep` keeps it.
* Moving one global row now covers every global copy of that skill; copies that differ must be reconciled first (`skilllib tidy --global`). Deleting one removes that copy and the links to it, and says where the skill still loads.
* Package links a move leaves pointing at nothing are named (`left` in `global move --json`).

### Never half done
* `add`, `sync`, `link`, `update` and `remove` check every folder they'd touch before writing anything. A skills folder that is a file, or links out of the repo, is reported, not written through.
* A file where a skill's folder goes is never deleted.
* `sync` never repoints a link that reaches other content.

### Doctor
* Doctor offers no choice that can't succeed, and `doctor --fix` converges.
* `doctor --fix` removes a broken link by itself only at a repo's top, uncommitted; committed links and links inside monorepo packages are always asked first.
* New reports: what's in the way of a link, a skills folder that isn't one, copies that differ behind a link, pins sync can't put back, pins from another library.

### Changes agents and scripts will notice
* `add` reports `unchanged` (nothing written) or `relinked` (only links written) instead of `updated` when nothing new was installed.
* `remove` drops just the pin when the skill's own folder isn't the repo's (a folder outside the repo, a file), and says what it left in `reason`.
* Change results can carry `inTheWay` (something is where a link goes); the command exits 1.
* `status` and other commands that take no names reject stray words; `unhide` and `folders` failures print `{"error"}` with `--json`.

### Plugins
* A plugin only turned on in your settings (not installed) is never offered for removal; turning it off edits your settings.
* A plugin a repo's settings turn on is shown as loading in that repo, not every repo, and its review prompt says so.
* Replacing a plugin with your own copies checks every repo can take them before anything changes.

### Also
* A skills folder that links to another folder in the repo (`.claude/skills` → `.agents/skills`) is treated as one folder: committed team skills there are the team's (never removed), and `add` finds nothing in its own way.
* `restore` that can't put a copy back prints `{"error"}` with `--json`; doctor shows a choice by label where `apply` needs one.
* Usage counts skip a transcript (or transcript folder) that can't be read, so `doctor` and `usage` no longer fail on one, and the app says when usage can't be shown; plugin skills are counted under `plugin:skill`.
* An empty `SKILLLIB_HOME` or `CLAUDE_CONFIG_DIR` falls back to the default; agents' own config folders are never treated as projects.
* A `SKILL.md` that starts with a byte-order mark is read correctly.
* Monorepo packages are looked for up to five folders deep; a package with its own `skilllib.json` counts even before you open it.
* The app's results wrap to three lines instead of being cut off; deletes and moves say what was left.
* Windows: link checks handle drive paths, `\\?\` targets and case.

## [1.11.3](https://github.com/atralice/skillLib/compare/v1.11.2...v1.11.3) (2026-10-19)


### Bug Fixes

* app review round: cursor follows its row, broken-link rows, narrow layout ([#74](https://github.com/atralice/skillLib/issues/74)) ([e3cfb8d](https://github.com/atralice/skillLib/commit/e3cfb8d7c33a74a586716e702935f02190df1a9d))
* doctor reports broken links inside repos ([#70](https://github.com/atralice/skillLib/issues/70)) ([6d3c4c7](https://github.com/atralice/skillLib/commit/6d3c4c7fb84f011ae67f13132e997039b2fdd83c))
* round 2 of the review: no lost copies, and commands that say what they did ([#68](https://github.com/atralice/skillLib/issues/68)) ([911c805](https://github.com/atralice/skillLib/commit/911c805cdba5fb62d299331a02eeea10dc5bdbbc))
* round 3 of the review ([#71](https://github.com/atralice/skillLib/issues/71)) ([8a14420](https://github.com/atralice/skillLib/commit/8a144209065226f94fb3ae5f6a3da1d955ef1797))
* round 4 of the review ([#72](https://github.com/atralice/skillLib/issues/72)) ([08ee234](https://github.com/atralice/skillLib/commit/08ee234972304ed306bbab31eca405ee49b03d01))
* round 5 of the review (other agent combinations) ([#73](https://github.com/atralice/skillLib/issues/73)) ([f16cb8d](https://github.com/atralice/skillLib/commit/f16cb8dd460278da9d040512b31a9370ab2b0981))
* round 6: a broken repo can't break list/show; plugin removal keeps your copy ([#75](https://github.com/atralice/skillLib/issues/75)) ([e4c677b](https://github.com/atralice/skillLib/commit/e4c677bd977810d3774cf63fea87271a2bdc7e90))
* round 7: /tmp imports record no origin; Your skills lines up at 80 columns ([#76](https://github.com/atralice/skillLib/issues/76)) ([e5ea84e](https://github.com/atralice/skillLib/commit/e5ea84ebb785d04757d7f053e496840fa1e94c1f))
* the app shows doctor's issues; its own issue engine goes ([#67](https://github.com/atralice/skillLib/issues/67)) ([81b5f80](https://github.com/atralice/skillLib/commit/81b5f809b0774604a7ca7a84f6865668d23a5fa7))

## [1.11.2](https://github.com/atralice/skillLib/compare/v1.11.1...v1.11.2) (2026-10-18)


### Bug Fixes

* bugs from the repo review, and --json errors agents can read ([#64](https://github.com/atralice/skillLib/issues/64)) ([c0ee2ab](https://github.com/atralice/skillLib/commit/c0ee2ab11dc8c5a5c66e658c5c6705125eb39e22))

## [1.11.1](https://github.com/atralice/skillLib/compare/v1.11.0...v1.11.1) (2026-10-18)


### Miscellaneous Chores

* release 1.11.1 to publish the new README on npm ([7e297b1](https://github.com/atralice/skillLib/commit/7e297b1be3d12bb1503f4236375df021e623c6d3))

## [1.11.0](https://github.com/atralice/skillLib/compare/v1.10.0...v1.11.0) (2026-10-17)


### Features

* add several library skills at once, a plugin's set in one go ([3948093](https://github.com/atralice/skillLib/commit/394809316ad28a37e1971fdad2ffb672ba7dafe6))
* agents can apply doctor's choices and move global skills into repos ([f54d508](https://github.com/atralice/skillLib/commit/f54d50889157d497c2ec896ab32e96eeef797fcb))
* status --json gives each issue an id that skilllib apply takes ([37c6b22](https://github.com/atralice/skillLib/commit/37c6b2292838db3d8c9e4a4098598ee1ef89ba38))


### Bug Fixes

* don't treat agent worktrees under .claude/worktrees as projects ([b47744e](https://github.com/atralice/skillLib/commit/b47744e14f28317bd615093d2be96f28b530afea))
* review findings for apply and global move ([8df21df](https://github.com/atralice/skillLib/commit/8df21df360a3b5e63b221e846b24944bdb5aade3))
