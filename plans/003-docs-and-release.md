# Plan 003: The release job is pinned, the docs match the code, and agents have an `AGENTS.md`

> **Executor instructions**: This plan has three parts (A to C). They do not
> depend on each other; do them in order. Follow each part step by step. Run
> every verification command and confirm the expected result before you go to
> the next step. Commit at the end of each part, after that part's "Done
> criteria" hold. If a "STOP condition" of a part occurs, stop that part,
> report it, and continue with the next part. Do not improvise. When all
> parts are done, update the status row for this plan in `plans/README.md`,
> unless a reviewer dispatched you and told you they maintain the index.
>
> **Drift check (run first)**: `git diff --stat da9073a..HEAD -- .github/ README.md src/index.ts skills/skilllib/SKILL.md`
> and `git ls-files | grep -iE '^(AGENTS|CLAUDE)\.md$'`.
> Each part says what to do when its files changed.

## Status

- **Priority**: P2 (part A), P3 (parts B and C)
- **Effort**: S for each part
- **Risk**: LOW
- **Depends on**: none. Do it after plans 001 and 002 when they are planned: they edit other lines of `skills/skilllib/SKILL.md`, and part B reads whether plan 002 part C landed.
- **Category**: security, docs, dx
- **Planned at**: commit `da9073a`, 2026-11-11

## Why this matters

Three small jobs that change no product behavior. Part A: the job that
publishes skilllib to npm runs actions referenced by a movable tag, in the
same job that holds the publish token. Part B: the README, the help text and
the agents' manual contradict the code in six places, and agents act on that
text. Part C: the repo has no `AGENTS.md`, so each agent session finds the
project's rules again or misses them.

## Parts

| Part | What | Commit message |
|---|---|---|
| A | The publish job runs only pinned actions and a pinned npm | `ci: pin the workflows' actions by commit and npm by version` |
| B | The README, the help text and the agents' manual say what the code does | Two commits. `docs: the README says install downloads skills, and which actions have no command` (only `README.md`). Then `fix: help says sync installs your personal pins too; the skill names plugin off` (`src/index.ts` and `skills/skilllib/SKILL.md`) |
| C | The repo has an `AGENTS.md` with the rules for changing skilllib | `docs: AGENTS.md, the rules for agents that change skilllib` |

Why part B has two commits: `docs:` commits do not make a release, and the
help text and `SKILL.md` ship in the npm package, so their change is a `fix:`.

## Git workflow

- Work in a git worktree of your own (`git worktree add <folder> -b advisor/003-docs-and-release origin/main`). If `git status --short` shows changed files that you did not make, STOP: do not switch branches, stash or commit in that checkout.
- One branch for the whole plan. Commits as in the table above. Conventional Commits, as in `git log`.
- Do not edit `version` in `package.json` or `CHANGELOG.md`: release-please owns them.
- Do NOT push or open a PR unless the operator told you to.

## Done criteria for the whole plan

- [ ] Each part's own "Done criteria" held before its commit (or the part is reported as stopped). A part's `git status --short` check is made before that part's commit.
- [ ] `git log --oneline origin/main..HEAD` shows four commits (one for A, two for B, one for C)
- [ ] `pnpm type-check` exits 0 and `pnpm test` reports `0 fail` on the last commit
- [ ] `plans/README.md` status row updated

---

## Part A: The publish job runs only pinned actions and a pinned npm

### Why this matters

`.github/workflows/release.yml` publishes the `skilllib` package to npm. Its
publish job can mint the npm publish token (`id-token: write`). The same job
runs four actions that are referenced by a tag (`@v6`, `@v4`, `@v2`) and
installs `npm@latest`. A tag can be moved to other code, and `latest` changes
by itself. If one of those is compromised, its code runs in the job that can
publish a package that users and agents install globally. Pinning each action
to a commit id and npm to a version removes that path. Dependabot then
proposes updates as normal pull requests.

### Current state

- `.github/workflows/release.yml`: release-please, then publish to npm.
- `.github/workflows/test.yml`: type check, tests and build on three systems.
- No `.github/dependabot.yml` exists.

`release.yml`, the lines with `uses:` and the npm install:

```yaml
  release-please:
    runs-on: ubuntu-latest
    permissions:
      contents: write # tags, releases, its branch
      pull-requests: write # the release PR
    …
    steps:
      - uses: googleapis/release-please-action@v4
        id: release

  publish:
    …
    permissions:
      contents: read
      id-token: write # npm trusted publishing + provenance
    steps:
      - uses: actions/checkout@v6
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v6
        with:
          node-version: "22"
          cache: "pnpm"
          registry-url: "https://registry.npmjs.org"
      - uses: oven-sh/setup-bun@v2
      - run: pnpm install --frozen-lockfile
      # Trusted publishing needs npm 11.5.1 or newer; Node 22 ships npm 10.
      - run: npm install -g npm@latest
```

`test.yml`, the top and the `uses:` lines:

```yaml
name: Test

on:
  pull_request:
  push:
    branches: [main]

jobs:
  test:
    …
    steps:
      - uses: actions/checkout@v6
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v6
        with:
          node-version: "22"
          cache: "pnpm"
      - uses: oven-sh/setup-bun@v2
```

`test.yml` has no `permissions:` block. It also has this step, which must stay
on `npm@latest` on purpose (its comment says it checks what the latest npm
would do):

```yaml
          npx -y npm@latest publish --dry-run --provenance=false 2>&1 | tee publish.log
```

Commit convention: Conventional Commits. `ci:` commits do not make a release.

### Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Commit id of a tag | `gh api repos/<owner>/<repo>/commits/<tag> --jq .sha` | 40 hex characters |
| Newest npm version | `npm view npm version` | a version such as `11.x.y` |
| Workflows still parse | see step 5 | prints `ok` |

`gh` must be logged in (`gh auth status` exits 0).

### Scope

**In scope**:
- `.github/workflows/release.yml`
- `.github/workflows/test.yml`
- `.github/dependabot.yml` (create)

**Out of scope**:
- The `npx -y npm@latest publish --dry-run` step in `test.yml`. It stays.
- What the jobs do, their triggers, the Node version.
- `package.json`.


### Steps

#### Step 1: Look up the commit id of each tag

Run these five commands and write down each result:

```bash
gh api repos/actions/checkout/commits/v6 --jq .sha
gh api repos/pnpm/action-setup/commits/v4 --jq .sha
gh api repos/actions/setup-node/commits/v6 --jq .sha
gh api repos/oven-sh/setup-bun/commits/v2 --jq .sha
gh api repos/googleapis/release-please-action/commits/v4 --jq .sha
```

**Verify**: each prints exactly 40 characters from `0-9a-f`.

#### Step 2: Pin the actions in both workflow files

In `.github/workflows/release.yml` and `.github/workflows/test.yml`, replace
each `uses: <action>@<tag>` with `uses: <action>@<sha> # <tag>`. Example of
the form (the id here is a placeholder, use the one from step 1):

```yaml
      - uses: actions/checkout@0123456789abcdef0123456789abcdef01234567 # v6
```

There are 5 `uses:` lines in `release.yml` and 4 in `test.yml`.

**Verify**:
- `grep -cE 'uses: .+@[0-9a-f]{40} # v[0-9]+' .github/workflows/release.yml` → `5`
- `grep -cE 'uses: .+@[0-9a-f]{40} # v[0-9]+' .github/workflows/test.yml` → `4`
- `grep -nE 'uses: .+@v[0-9]' .github/workflows/*.yml` → no output

#### Step 3: Pin npm in the publish job

Run `npm view npm version`. The result must be `11.5.1` or newer. In
`release.yml`, change

```yaml
      - run: npm install -g npm@latest
```

to (with the version you got):

```yaml
      - run: npm install -g npm@<version>
```

Keep the comment line above it.

**Verify**: `grep -n "npm install -g npm@" .github/workflows/release.yml`
shows one line with a version number and not `latest`.

#### Step 4: Least privilege for the test workflow, and Dependabot

1. In `.github/workflows/test.yml`, add after the `on:` block and before
   `jobs:`:

```yaml
# The tests only read the repo.
permissions:
  contents: read
```

2. Create `.github/dependabot.yml`:

```yaml
# Keeps the pinned actions current: one PR per update, titled as a Conventional Commit that doesn't release.
version: 2
updates:
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
    commit-message:
      prefix: ci
```

**Verify**: `grep -c "contents: read" .github/workflows/test.yml` → `1`.

#### Step 5: The files still parse

Run from the repo root (the repo has the `yaml` package installed):

```bash
node --input-type=module -e "import { parse } from 'yaml'; import { readFileSync } from 'node:fs'; for (const f of process.argv.slice(1)) parse(readFileSync(f, 'utf8')); console.log('ok')" .github/workflows/release.yml .github/workflows/test.yml .github/dependabot.yml
```

**Verify**: prints `ok`.

### Test plan

No unit tests. `test.yml` runs on the pull request, which proves its pins
work. `release.yml` runs only after a merge to `main`. If a pin in it is
wrong, the job fails before it publishes: nothing bad is released, and the fix
is a new commit.

### Done criteria

- [ ] The three `grep` checks of step 2 pass
- [ ] `grep -c "npm@latest" .github/workflows/release.yml` → `0`
- [ ] `grep -c "npm@latest" .github/workflows/test.yml` → `2` (the dry-run step and its error message, both unchanged)
- [ ] Step 5 prints `ok`
- [ ] `git status --short` lists only the three in-scope files (and `plans/`)

### STOP conditions

Stop and report if:

- `gh auth status` fails, or a `gh api` call in step 1 returns an error.
- `npm view npm version` returns a version older than `11.5.1`.
- The workflow files differ from the "Current state" excerpts.

### Maintenance notes

- Tell the maintainer: Dependabot must be allowed for the repo (GitHub →
  Settings → Code security). Without it, the pins never update.
- The pinned npm version also needs a manual bump now and then; Dependabot's
  `github-actions` updates do not cover a `run:` line.
- Reviewer: compare each commit id with the action's releases page.

---

## Part B: The README, the help text and the agents' manual say what the code does

### Why this matters

Since version 1.13, `skilllib install` downloads skills from skills.sh and
GitHub. Three places in the README still say the opposite or hide it. The help
text that ships in the binary says `sync` reads only `skilllib.json`, but
since 1.12 pins are personal by default and `sync` installs those too. The
agents' manual tells agents to turn a plugin off with `/plugin`, although
`skilllib plugin off` exists since 1.14. Agents and people act on these
texts, so wrong text causes wrong actions.

### Current state

Files:

- `README.md`: the product documentation.
- `src/index.ts`: `HELP` (lines 7-63) is the text of `skilllib help`.
- `skills/skilllib/SKILL.md`: the manual that loads into agent sessions. It
  ships in the npm package. Keep it short: every word costs context.

The six texts to change. Line numbers are from commit `da9073a`.

**A. `README.md:112`** (a row of the table under "Use it from your agents"):

```
| *Add the skill from github.com/acme/skills to my library.* | Clones the repo into a temporary folder, then `import <dir>` and `add <name>`. skilllib itself downloads nothing |
```

**B. `README.md:384`** (first line under "## Command line"):

```
Everything the app does also works as a command, for your agents, scripts and CI:
```

Facts for the new text: the terminal app can delete a library skill or a
global skill, pin an older version of a skill, and update or uninstall a
plugin. The CLI has no command of its own for those (`src/index.ts` has no
`delete` command; `add` takes no version; `plugin` takes only `off` and
`on`). Three of them can run through `skilllib apply`, but only while
`doctor` reports a matching issue: delete unused library skills
(`unused:library`), uninstall an unused plugin (`plugin-unused:…`), update a
plugin (`plugin-update:…`). Deleting a global skill and pinning an older
version have no CLI path at all.

**C. `README.md:429`** (the sentence that lists the `--json` commands):

```
It works with `status`, `list`, `show`, `projects`, `outdated`, `usage`, `doctor`, `apply`, `add`, `remove`, `sync`, `update`, `import`, `global move`, `agent-skill`, `check` and `plugin`.
```

The code also prints JSON for `install` and `search`
(`json("install", …)` and `json("search", …)` in `src/commands.ts`).

**D. `README.md:489`** (the last bullet under the FAQ entry
"**What's not supported yet?**"):

```
- Downloading skills: `skilllib install owner/repo`, `owner/repo@skill`, a skills.sh or GitHub URL, or a local folder. It imports into your library and, in a repo, adds the skill here. `--global` loads it in every repo. `skilllib search <query>` looks up skills.sh. A repo with many skills is listed until you name one or pass `--all`. Everything else skilllib does stays on this machine.
```

This describes a feature that works, under a heading that says "not
supported".

**E. `src/index.ts:36`** (in `HELP`):

```
  skilllib sync [--all]          Install exactly the versions in skilllib.json
```

**F. `skills/skilllib/SKILL.md:19`** (inside the long `source` bullet):

```
`plugin` (Claude Code plugin; turn off with `/plugin`)
```

Writing rules for this repo's docs:

- Simple English: short sentences (25 words at most), active voice, one topic
  in each sentence, no filler.
- Keep the existing Markdown structure and tone.

Commit convention: Conventional Commits. `docs:` does not make a release.
`fix:` makes a patch release. The help text and `SKILL.md` ship in the
package, so their change is a `fix:`.

### Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Type check | `pnpm type-check` | exit 0, no errors |
| All tests | `pnpm test` | `0 fail` |
| Help text from source | `pnpm -s dev help` | prints the help |

### Suggested executor toolkit

- If a skill named `simple-english` is available, use it for the new
  sentences.

### Scope

**In scope**:
- `README.md` (texts A, B, C, D only)
- `src/index.ts` (text E only, inside `HELP`)
- `skills/skilllib/SKILL.md` (text F only)

**Out of scope**:
- Any other README section, even if you see more to improve. Report it.
- `docs/DESIGN.md` and `docs/design/*` (the app's design).
- `CHANGELOG.md` (release-please writes it).
- New commands. This part changes words only.


### Steps

#### Step 1: README text A

Replace the row with:

```
| *Add the skill from github.com/acme/skills to my library.* | `install acme/skills@<name> --json`. It downloads the repo, puts the skill in your library, and in a repo adds it here. `search <query> --json` finds a skill first |
```

**Verify**: `grep -c "skilllib itself downloads nothing" README.md` → `0`.

#### Step 2: README text B

Replace the line with:

```
Most of what the app does also works as a command, for your agents, scripts and CI. A few actions have no command of their own yet. Deleting a library skill and updating or uninstalling a plugin run only through `skilllib apply`, when `doctor` reports them. Deleting a global skill and pinning an older version are app-only.
```

**Verify**: `grep -c "Everything the app does also works as a command" README.md` → `0`.

#### Step 3: README text C

In that sentence, insert `` `install`, `search`, `` after `` `agent-skill`, ``
so it ends:

```
`global move`, `agent-skill`, `install`, `search`, `check` and `plugin`.
```

Then check plan 002 (part C): run `grep -c 'json("help"' src/index.ts`. If it prints
`1`, also add `` `help`, `version`, `` directly before `` `check` ``. If it
prints `0`, add nothing more.

**Verify**: `grep -c '`agent-skill`, `install`, `search`' README.md` → `1`.

#### Step 4: README text D

1. Delete the whole bullet (text D) from the list under
   "**What's not supported yet?**".
2. Directly before the line `**What's not supported yet?**`, add a new FAQ
   entry and an empty line after it:

```
**Can it download skills?** Yes: `skilllib install owner/repo`, `owner/repo@skill`, a skills.sh or GitHub URL, or a local folder. It puts the skill in your library and, in a repo, adds it here. `--global` loads it in every repo. `skilllib search <query>` searches skills.sh. A repo with many skills is listed until you name one or pass `--all`. Everything else skilllib does stays on this machine.
```

**Verify**: `grep -c "^- Downloading skills:" README.md` → `0`, and
`grep -c "Can it download skills?" README.md` → `1`.

#### Step 5: Help text E

In `src/index.ts`, replace the line with (keep the column alignment):

```
  skilllib sync [--all]          Install exactly the pinned versions (your personal pins and skilllib.json)
```

**Verify**: `pnpm -s dev help | grep -c "your personal pins and skilllib.json"` → `1`.

#### Step 6: Manual text F

In `skills/skilllib/SKILL.md`, replace text F with:

```
`plugin` (Claude Code plugin; `skilllib plugin off <id>` turns it off)
```

**Verify**: `grep -c 'turn off with `/plugin`' skills/skilllib/SKILL.md` → `0`.

#### Step 7: Full check

**Verify**: `pnpm type-check && pnpm test` → exit 0, `0 fail`.

### Test plan

No new tests: these are text changes. The existing suite must still pass,
because some tests install the bundled `SKILL.md`.

### Done criteria

- [ ] All six `grep` checks of steps 1-6 pass
- [ ] `pnpm type-check` exits 0 and `pnpm test` reports `0 fail`
- [ ] `git diff --stat` shows only `README.md`, `src/index.ts`, `skills/skilllib/SKILL.md`
- [ ] `git diff -- src/index.ts` changes exactly one line

### STOP conditions

Stop and report if:

- A test fails after step 5 or 6. A test may compare the help text or the
  bundled skill. Report the test name; do not change the test.
- More than two of the six texts are not found in the files. Then the docs
  were rewritten since this part, and it needs a new review.

### Maintenance notes

- Text B lists the actions that have no command of their own. When a CLI
  command for one of them lands, remove it from those sentences. When all are gone, restore the old
  claim.
- No test ties the README or the help text to the commands. A cheap guard is
  a test that walks `FLAGS_OF` in `src/index.ts` and checks that each command
  name appears in `HELP` and in `SKILL.md`. That needs `FLAGS_OF` to be
  exported, so it is left for a later plan.
- Other small gaps seen in the audit and not fixed here: `SKILL.md` does not
  describe the flags of `tidy` (`--dry-run`, `--allow-git`, `--keep`),
  `import --global`, or `sync --all` and `update --all`. The help text's
  "Options:" line lists 3 of about 12 flags.

---

## Part C: The repo has an `AGENTS.md` with the rules for changing skilllib

### Why this matters

Coding agents do most of the work in this repo. The rules they need are
spread over the README's last section, the workflow files and the
maintainer's head: which commands to run, that agents are the main user of
the product, that `--json` output is a public contract, that release-please
owns the version. Each new agent session finds these again, or misses them.
One of the rules was missed in practice: the app got several actions that the
CLI does not have. A short `AGENTS.md` at the repo root gives every agent the
same rules at the start of a session.

### Current state

- The repo tracks no `AGENTS.md` and no `CLAUDE.md`.
- `package.json` publishes only `dist`, `skills`, `README.md` and `LICENSE`
  (its `files` field). A new root file does not go into the npm package.

Facts that the new file states. Each was checked against the repo at commit
`da9073a`:

| Fact | Where it comes from |
|---|---|
| `pnpm install`, `pnpm type-check`, `pnpm test`, `pnpm build`, `pnpm dev`, `pnpm design` | `package.json` scripts |
| Tests run on bun, about 30 seconds, 413 tests | `package.json` (`bun test --timeout 20000 src`), a run on 2026-11-10 |
| CI runs on Linux, macOS and Windows | `.github/workflows/test.yml` |
| Conventional Commits; release-please owns `version` and `CHANGELOG.md` | `README.md`, section "Development" |
| A JSON field is removed or changed only in a major version | `README.md` ("A field is only removed or changed in a major version"), header comment of `src/json.ts` |
| One line of JSON on stdout, messages on stderr, exit 1 when not all was done | `README.md`, section "Command line" |
| Local imports end in `.js`; git runs through `execFileSync` with an argument list | every file in `src/`, for example `src/git.ts` |
| State files use `readState` / `writeState` | `src/paths.ts:96-130` |
| Tests set `HOME`, `SKILLLIB_HOME`, `CLAUDE_CONFIG_DIR` to a temp folder | `src/commands.test.ts:21-35` |
| Symlink tests are skipped on Windows | `src/library.test.ts:604` |
| After a UI change: `pnpm design`, and update `docs/DESIGN.md` in the same PR | `docs/DESIGN.md`, top of the file |
| Agents are the main user; no app-only features | The maintainer's stated direction (October 2026). It is not written in the repo yet. The maintainer must confirm this rule in review. |

### Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Files are new | `git status --short` | `?? AGENTS.md` and `?? CLAUDE.md` |

### Scope

**In scope**:
- `AGENTS.md` (create, at the repo root)
- `CLAUDE.md` (create, at the repo root)

**Out of scope**:
- `README.md`, `package.json`, anything under `src/`.
- Rules that are not in the text below. Do not add your own.


### Steps

#### Step 1: Create `AGENTS.md`

Create the file with exactly this content:

````markdown
# skilllib: rules for agents

skilllib is a CLI, with a terminal app, that manages agent skills. `README.md` describes the product. This file has the rules for changing the code.

## Commands

| Purpose | Command |
|---|---|
| Install | `pnpm install` |
| Type check | `pnpm type-check` |
| Tests (on bun, about 30 seconds) | `pnpm test` |
| One test file | `bun test --timeout 20000 src/<name>.test.ts` |
| Build | `pnpm build` |
| Run from source | `pnpm dev <command>` |
| Render the app's screens | `pnpm design` |

Run the type check and the tests before you say that a change is done.

## Product rules

1. **Agents are the main user.** Each capability must work as a CLI command with `--json`. Do not add a feature that only the app (`src/tui`) has.
2. **Keep the surfaces in step.** When you add or change a command or a flag, update these in the same change:
   - `HELP` and `FLAGS_OF` in `src/index.ts`
   - `skills/skilllib/SKILL.md`
   - the command block and the list of `--json` commands in `README.md`
3. **`--json` is a public contract.**
   - stdout has exactly one line of JSON. Messages go to stderr.
   - A command that did not do all that was asked exits 1.
   - A stopping error prints `{"error": "..."}` and exits 1.
4. **`src/json.ts` has the public types.** You can add a field. Do not remove a field, rename it, or change its meaning: that needs a major version.
5. **Do not lose user data.** What skilllib removes goes to a backup that `skilllib restore` puts back. Do not change a file that git tracks unless the user chose that.
6. **`skills/skilllib/SKILL.md` loads into every agent session.** Keep it short.

## Code

- TypeScript, strict, ESM. Imports of local files end in `.js`.
- No `any` and no `@ts-ignore`.
- Run git and other programs with `execFileSync` and a list of arguments. Do not build shell strings.
- Read and write skilllib's own state files with `readState` and `writeState` (`src/paths.ts`).
- Comments say why, in short sentences.

## Tests

- Tests are in `src/*.test.ts` and use `bun:test`.
- Each test file sets `HOME`, `SKILLLIB_HOME` and `CLAUDE_CONFIG_DIR` to a temp folder in `beforeEach`. A test must not touch the real home folder.
- A test name is a full sentence that states the behavior.
- Write tests for behavior that can break: logic, edge cases, bugs you fixed, contracts between parts. Do not write tests for getters, constants or code that only passes data through.
- A test that makes symlinks uses `test.skipIf(process.platform === "win32")`.
- CI runs on Linux, macOS and Windows.

## The app (`src/tui`)

- `docs/DESIGN.md` has the design rules. Read it before you change the app.
- After a UI change, run `pnpm design`, commit the changed files in `docs/design`, and update `docs/DESIGN.md` in the same change.

## Commits and releases

- Commit messages and PR titles are Conventional Commits. `fix:` makes a patch release and `feat:` a minor release. `docs:`, `ci:`, `chore:`, `test:` and `refactor:` do not release.
- release-please makes the versions. Do not edit `version` in `package.json`, `CHANGELOG.md` or `.release-please-manifest.json`.
- Make a branch from `origin/main`.

## Docs

Write docs in simple English: short sentences, active voice, one topic in each sentence.
````

**Verify**: `grep -c "^## " AGENTS.md` → `7`.

#### Step 2: Create `CLAUDE.md`

Claude Code reads `CLAUDE.md`. Other agents read `AGENTS.md`. So `CLAUDE.md`
only points at the shared file. Create it with exactly this content:

```markdown
# Instructions

The instructions for this repo are in AGENTS.md, so every agent reads the same text.

@AGENTS.md
```

**Verify**: `grep -c "^@AGENTS.md$" CLAUDE.md` → `1`.

#### Step 3: Check that nothing else changed

**Verify**: `git status --short` shows exactly `?? AGENTS.md` and
`?? CLAUDE.md` (and `?? plans/` if the plans are not committed).

### Test plan

No tests: two documentation files.

### Done criteria

- [ ] `AGENTS.md` exists and `grep -c "^## " AGENTS.md` → `7`
- [ ] `CLAUDE.md` exists and contains the line `@AGENTS.md`
- [ ] `git status --short` lists no other changed file (apart from `plans/`)

### STOP conditions

Stop and report if:

- `AGENTS.md` or `CLAUDE.md` already exists (tracked or not).
- `pnpm test` no longer exists as a script in `package.json`, or a command in
  the table of step 1 is not in `package.json`. Then the file would be wrong
  from the first day.

### Maintenance notes

- **For the maintainer's review:** product rule 1 comes from your stated
  direction, not from a file in the repo. Change the wording if it is too
  strict. Product rule 2 names four places that must stay in step; plan 003 (part B)'s
  notes suggest a test that enforces part of it.
- When plan 002 (part D) lands (`src/contract.test.ts`), add one line under "Tests":
  a new command with `--json` needs a row in that file.
- Keep this file short. Agents load it in every session.
