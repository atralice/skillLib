# Plan 004: `status --json` reads only this repo's transcripts and computes its status once

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before you go to the
> next step. If a "STOP condition" occurs, stop and report. Do not improvise.
> When done, update the status row for this plan in `plans/README.md`, unless
> a reviewer dispatched you and told you they maintain the index.
>
> This plan starts with a measurement. Step 2 can end the plan with the
> verdict "not worth doing". That is a valid result.
>
> **Drift check (run first)**: `git diff --stat da9073a..HEAD -- src/usage.ts src/commands.ts src/here.ts src/usage.test.ts`
> If an in-scope file changed, compare the "Current state" excerpts with the
> live code. A mismatch in the excerpts is a STOP condition. Shifted line
> numbers alone are not.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/002-cli-contract.md, part D (it guards the output while this plan changes shared code)
- **Category**: perf
- **Planned at**: commit `da9073a`, 2026-11-11

## Why this matters

Every time an agent loads the `skilllib` skill, it runs
`skilllib status --json`. To fill one optional field (`usesHere`: how often
Claude Code used each skill in this repo), the command lists and checks the
transcript files of **every** project on the machine, then throws away the
uses of other projects. It also computes the repo's skill status twice (each
time it hashes every file of every managed skill). The cost grows with the
number of projects and sessions on the machine, not with what the output
needs. The audit counted the calls but did not time them, so this plan
measures first.

## Current state

- `src/commands.ts`: `status` (line 226) and `usageBySkill` (lines 179-184).
- `src/usage.ts`: `transcriptFiles` (lines 69-95) lists transcript files;
  `scanUsage` (lines 131-163) reads them through a cache.
- `src/here.ts`: `usableHere` (line 50) builds the `status --json` data;
  `statusIssues` (lines 45-47) finds the repo's issues.
- `src/usage.test.ts`: tests for transcript reading.

`usageBySkill`, `src/commands.ts:179-184`. With `onlyProject` set, it still
scans everything and filters afterwards:

```ts
async function usageBySkill(days: number, onlyProject?: string): Promise<Map<string, UsageSummary>> {
  const projectOf = projectOfFactory(onlyProject ? [onlyProject, ...knownProjects()] : knownProjects());
  const uses = await scanUsage(days);
  const scoped = onlyProject ? uses.filter((u) => projectOf(u.cwd) === onlyProject) : uses;
  return new Map(summarize(scoped, projectOf).map((s) => [s.skill, s]));
}
```

`projectOf` (`src/commands.ts:168-177`) maps a session's working folder to a
project. A use counts for `onlyProject` only when the session's folder **is**
that root or is **inside** it:

```ts
    const known = sorted.find((p) => cwd === p || cwd.startsWith(p + sep));
    if (known) return known;
    const repo = cwd.split(`${sep}.claude${sep}worktrees${sep}`)[0]!;
    return isProjectCandidate(repo) ? repo : null;
```

`transcriptFiles`, `src/usage.ts:69-95`:

```ts
function transcriptFiles(sinceMs: number): string[] {
  const base = join(claudeDir(), "projects");
  if (!existsSync(base)) return [];
  // A folder that can't be read (root-owned after sudo) is skipped, as an unreadable transcript is.
  const list = (dir: string) => {
    try {
      return readdirSync(dir);
    } catch {
      return [];
    }
  };
  return list(base).flatMap((project) => {
    const dir = join(base, project);
    if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return []; // a link to nothing is skipped
    return list(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => join(dir, f))
      …
```

The start of `scanUsage`, `src/usage.ts:131-142`:

```ts
export async function scanUsage(days: number): Promise<SkillUse[]> {
  const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;
  const files = transcriptFiles(sinceMs);
  const cache = readUsageCache();
  let dirty = false;
  // A transcript that's gone doesn't stay in the cache. Ones outside this window stay, for a longer --days.
  for (const file of Object.keys(cache.files)) {
    if (!files.includes(file) && !existsSync(file)) {
      delete cache.files[file];
      dirty = true;
    }
  }
```

`files.includes(file)` inside a loop over the cache is a list search for each
cached file.

How Claude Code names the folders under `~/.claude/projects`: one folder per
working folder of a session. The name is the folder's path with each
character that is not a letter or a digit replaced by `-`. Example seen on the
maintainer's machine: the path `/Users/x/Projects/totono.xyz/skillLib` has the
folder `-Users-x-Projects-totono-xyz-skillLib`. A session inside the repo
(`…/skillLib/packages/web`) has a folder whose name **starts with** the
repo's folder name. So, for one repo root, only folders whose name starts
with the encoded root can hold uses that count.

`statusIssues` and where `usableHere` computes the same status,
`src/here.ts:45-47` and `83-89`:

```ts
export function statusIssues(root: string, machine = machineSkills(enabledHarnesses())): Issue[] {
  return findIssues(projectHere(root) === root ? [root] : [], machine, new Set(librarySkills().map((l) => l.name)));
}
```

```ts
  const own = (() => {
    try {
      return inRepo ? projectStatus(root) : [];
    } catch {
      return [];
    }
  })();
```

`findIssues` (`src/health.ts:295-302`) takes an optional 4th argument
`statusOf: (root: string) => ProjectSkill[] = projectStatus`. It calls it only
for repos whose pins can be read. `usableHere` calls `statusIssues(root, machine)`
at `src/here.ts:106`. `apply` in `src/commands.ts` also calls
`statusIssues(findProjectRoot())` with one argument.

Conventions to match: TypeScript strict, ESM, local imports end in `.js`, no
`any`. Comments are short and say why. Test names are full sentences.
`src/usage.test.ts` builds transcript folders in a temp `CLAUDE_CONFIG_DIR`;
read its first 130 lines for the fixture pattern before you write a test.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Type check | `pnpm type-check` | exit 0, no errors |
| Usage tests | `bun test --timeout 20000 src/usage.test.ts` | `0 fail` |
| All tests | `pnpm test` | `0 fail` |
| Build | `pnpm build` | exit 0 (writes `dist/`, which git ignores) |

## Scope

**In scope**:
- `src/usage.ts`
- `src/commands.ts` (only `usageBySkill`)
- `src/here.ts` (only `statusIssues` and its one call in `usableHere`)
- `src/usage.test.ts`

**Out of scope**:
- `src/health.ts`, `src/git.ts`, `src/library.ts`, `src/tidy.ts`. The audit
  also saw repeated `git` process starts there (about one per skill for some
  checks). That change touches the code with the highest risk in the repo and
  needs its own plan with measurements.
- The shape of `status --json`. No field changes.
- `skilllib usage`, `doctor` and `check`: they need every project's uses and
  keep the full scan.

## Git workflow

- Work in a git worktree of your own (`git worktree add <folder> -b <branch> origin/main`). If `git status --short` shows changed files that you did not make, STOP: do not switch branches, stash or commit in that checkout.
- Branch: `git fetch origin && git switch -c advisor/004-status-json-speed origin/main`
- One commit per kept step. Example: `perf: status reads only this repo's transcripts`
- Do NOT push or open a PR unless the operator told you to.

## Steps

### Step 1: Measure the baseline

This step runs the real command on the operator's machine, in this repo. It is
the same command that every agent session runs; it reads the real
`~/.claude` and `~/.skilllib` and may refresh skilllib's own cache files
there. If the operator told you not to touch the real home folder, STOP.

```bash
pnpm build
for i in 1 2 3; do /usr/bin/time -p node dist/index.js status --json > /dev/null; done
node dist/index.js status --json > /tmp/skilllib-status-before.json
ls ~/.claude/projects | wc -l
```

Write down: the `real` time of the third run (call it T0, in seconds), and
the number of project folders (call it P). The saved file is the output to
compare with in step 6.

**Verify**: three `real` lines are printed and the third is noted, and
`/tmp/skilllib-status-before.json` holds one line of JSON.

### Step 2: Decide

- If **T0 < 0.40** → the command is fast enough on this machine. Do not change
  code. Set this plan's row in `plans/README.md` to
  `REJECTED (fast enough: T0 = <value> s with <P> project folders)` and stop.
- Otherwise continue with step 3.

### Step 3: Read only this repo's transcript folders

In `src/usage.ts`:

1. Add this helper before `transcriptFiles`:

```ts
/**
 * Claude Code keeps a session's transcript in a folder named after the session's working folder, with every
 * character that isn't a letter or digit as "-". A session in `root` or inside it is in a folder whose name
 * starts with root's. Some other folders match too (a sibling "repo2"): their uses are filtered later, by cwd.
 */
const folderKey = (path: string) => path.replace(/[^A-Za-z0-9]/g, "-");
```

2. Give `transcriptFiles` a second, optional parameter and filter the project
   folders with it:

```ts
function transcriptFiles(sinceMs: number, under?: string): string[] {
  …
  const key = under === undefined ? null : folderKey(under);
  return list(base)
    .filter((project) => key === null || folderKey(project).startsWith(key))
    .flatMap((project) => {
      …unchanged…
    });
}
```

3. Give `scanUsage` the same optional parameter and pass it on. Also make the
   file list a `Set` for the cache loop:

```ts
/** Every skill use recorded in Claude Code transcripts over the last `days` days; with `under`, only sessions in that folder or inside it. */
export async function scanUsage(days: number, under?: string): Promise<SkillUse[]> {
  const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;
  const files = transcriptFiles(sinceMs, under);
  const listed = new Set(files);
  …
  for (const file of Object.keys(cache.files)) {
    if (!listed.has(file) && !existsSync(file)) {
```

   Leave the rest of `scanUsage` as it is. The cache loop stays correct: it
   only drops entries whose file no longer exists.

4. In `src/commands.ts`, in `usageBySkill`, change one line:
   `const uses = await scanUsage(days);` → `const uses = await scanUsage(days, onlyProject);`

**Verify**: `pnpm type-check` → exit 0, and
`bun test --timeout 20000 src/usage.test.ts` → `0 fail`.

### Step 4: Test the folder filter

Read `src/usage.test.ts` lines 1-130 to see how a test writes a transcript
into `<CLAUDE_CONFIG_DIR>/projects/<folder>/<file>.jsonl`. Add one test that:

1. Writes three transcript folders, each with one `Skill` tool call (use the
   same line shape as the `assistant` constant at the top of that file, with
   different `id` values and a `timestamp` of now):
   - folder `-code-app`, record `cwd: "/code/app"`
   - folder `-code-app-packages-web`, record `cwd: "/code/app/packages/web"`
   - folder `-code-other`, record `cwd: "/code/other"`
2. Calls `await scanUsage(30, "/code/app")` and expects the `cwd` values of
   the result, sorted, to equal `["/code/app", "/code/app/packages/web"]`.
3. Calls `await scanUsage(30)` and expects 3 uses.

Name: `"with a folder, only sessions in it or inside it are read"`.

**Verify**: `bun test --timeout 20000 src/usage.test.ts` → `0 fail`, the new
test passes.

### Step 5: Compute the repo's status once

In `src/here.ts`:

1. Change `statusIssues` to accept the status that the caller already has:

```ts
/**
 * The issues `status --json` reports in `root`: this repo's, if it is one, and your global skills'.
 * `statusOf`: the repo's status when the caller already has it (each one hashes every managed skill's files).
 */
export function statusIssues(root: string, machine = machineSkills(enabledHarnesses()), statusOf?: (root: string) => ProjectSkill[]): Issue[] {
  return findIssues(projectHere(root) === root ? [root] : [], machine, new Set(librarySkills().map((l) => l.name)), statusOf);
}
```

   `ProjectSkill` is already imported in `src/here.ts` (it is used by `group`).
   Passing `undefined` as the 4th argument makes `findIssues` use its default.

2. In `usableHere`, change the call `statusIssues(root, machine)` to
   `statusIssues(root, machine, () => own)`.

   This is safe because `findIssues` calls `statusOf` only for a repo whose
   pins can be read, and in that case `own` holds the result of
   `projectStatus(root)`.

**Verify**: `pnpm type-check && pnpm test` → exit 0, `0 fail`.

### Step 6: Measure again and compare the output

```bash
pnpm build
for i in 1 2 3; do /usr/bin/time -p node dist/index.js status --json > /dev/null; done
node dist/index.js status --json > /tmp/skilllib-status-after.json
diff /tmp/skilllib-status-before.json /tmp/skilllib-status-after.json && echo same
```

Run both measurements from the same folder (the one you ran step 1 in), so
both describe the same repo. Do not use `git stash` or switch branches to get
the "before" output: step 1 saved it.

Write down the third `real` time (T1). Run this step while no Claude Code
session is active in this repo: a live session adds uses between the two
runs, and `usesHere` then differs for that reason only.

**Verify**: `diff` prints `same`. If T1 is not lower than T0, see STOP
conditions.

## Test plan

- One new test in `src/usage.test.ts` for the folder filter, including a
  session in a subfolder of the repo (it must still count).
- The output comparison in step 6 guards the `status --json` data.
- Plan 002 (part D)'s contract test guards the output shape.

## Done criteria

Either the plan ended at step 2 with a REJECTED row, or ALL of these hold:

- [ ] `pnpm type-check` exits 0 and `pnpm test` reports `0 fail`
- [ ] The new usage test passes
- [ ] Step 6 printed `same`
- [ ] T1 < T0, and both values are in the commit message body
- [ ] `git status --short` lists only the four in-scope files (and `plans/`)
- [ ] `plans/README.md` status row updated (with T0 and T1)

## STOP conditions

Stop and report if:

- The excerpts in "Current state" do not match the live code.
- Step 6's `diff` shows a difference. Then the folder filter dropped uses
  that counted before (the folder naming assumption is wrong on this
  machine). Revert step 3 and report the differing `usesHere` entries.
- T1 is not lower than T0. Revert the code changes, set the row to
  `REJECTED (no measurable gain: T0 = …, T1 = …)`.
- On Windows the new test fails. The folder naming there was not checked.

## Maintenance notes

- The folder filter depends on how Claude Code names its project folders. It
  errs on the safe side (it reads more folders, never fewer, as long as the
  name starts with the encoded root). If Claude Code changes the naming so
  that names no longer start that way, `usesHere` goes empty; step 4's test
  does not catch that, because it writes the folders itself.
- Deferred: fewer `git` process starts in `src/health.ts` (one snapshot per
  repo for a whole scan, and one `check-ignore` call with `--stdin` for all
  paths), and a memo for `treeHash` during a scan. Measure before doing it.
- Reviewer: check that `skilllib usage` and `doctor` still call `scanUsage`
  with one argument.
