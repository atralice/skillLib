# Plan 002: The CLI keeps its contract with agents: right list, one JSON line, no broken store

> **Executor instructions**: This plan has four parts (A to D). Do them in
> order. Follow each part step by step. Run every verification command and
> confirm the expected result before you go to the next step. Make one commit
> at the end of each part, after that part's "Done criteria" hold. If a "STOP
> condition" of any part occurs, stop the whole plan and report which parts
> are committed. Do not improvise. When all parts are done, update the status
> row for this plan in `plans/README.md`, unless a reviewer dispatched you and
> told you they maintain the index.
>
> **Drift check (run first)**: `git diff --stat da9073a..HEAD -- src/commands.ts src/index.ts src/output.ts src/json.ts src/health.ts src/usage.ts src/versions.ts src/commands.test.ts src/health.test.ts src/library.test.ts skills/skilllib/SKILL.md`
> If a listed file changed, compare the "Current state" excerpts of each part
> with the live code before you start that part. A mismatch in an excerpt is a
> STOP condition. Shifted line numbers alone are not. Changes that plan 001 or
> an earlier part of this plan made are expected.

## Status

- **Priority**: P2
- **Effort**: M-L (parts A, B, C are S; part D is M)
- **Risk**: LOW
- **Depends on**: plans/001-install-hardening.md (only part D needs it: one row of its test checks the exit code that plan 001 part B fixes). Parts A, B and C need nothing.
- **Category**: bug, tests
- **Planned at**: commit `da9073a`, 2026-11-11

## Why this matters

Agents are the main user of skilllib. They call it with `--json`, parse one
line of stdout and read the exit code. The audit found three bugs in that
contract and in the data behind it, and no test that checks the contract for
every command. Part A makes `apply` act on the list that `doctor` showed.
Part B stops an interrupted run from blocking a skill. Part C closes three
cases where `--json` does not print one JSON line. Part D adds the test that
would have caught these.

## Parts

| Part | What | Commit message |
|---|---|---|
| A | `apply` uses the same usage window that `doctor` showed | `fix: apply uses the --days window doctor showed (the issue id carries it)` |
| B | An interrupted run cannot leave a skill's version store broken | `fix: a run that stops while it records a version no longer blocks that skill` |
| C | `--json` always prints one JSON line, also for `help`, in a terminal, and in a sandbox | `fix: --json stays one JSON line for help, in a terminal, and where ~/.skilllib can't be written` |
| D | One test checks the `--json` contract of every command | `test: every command's --json prints one JSON line and the right exit code` |

Parts A and C both add a test at the end of `src/commands.test.ts`. That is
fine in sequence: add part C's tests after part A's.

## Git workflow

- Work in a git worktree of your own (`git worktree add <folder> -b advisor/002-cli-contract origin/main`). If `git status --short` shows changed files that you did not make, STOP: do not switch branches, stash or commit in that checkout.
- One branch for the whole plan. One commit for each part, with the message from the table above. Conventional Commits, as in `git log`.
- If plan 001 is not merged into `origin/main` yet, do parts A, B and C, then stop and report that part D waits for plan 001.
- Do not edit `version` in `package.json` or `CHANGELOG.md`: release-please owns them.
- Do NOT push or open a PR unless the operator told you to.

## Done criteria for the whole plan

- [ ] Each part's own "Done criteria" held before its commit. A part's `git status --short` check is made before that part's commit.
- [ ] `git log --oneline origin/main..HEAD` shows four commits, in the order A, B, C, D (or three, with part D reported as waiting)
- [ ] `pnpm type-check` exits 0 and `pnpm test` reports `0 fail` on the last commit
- [ ] `plans/README.md` status row updated

---

## Part A: `apply` uses the same usage window that `doctor` showed

### Why this matters

`skilllib doctor --days 90` lists skills that had no use in 90 days. Its
issue id is `unused:<repo path>`. The agent then runs
`skilllib apply unused:<repo path> 1`. `apply` builds the list again with the
default window of 30 days. A 30-day window flags **more** skills than a 90-day
window. So `apply` removes skills that the agent and the user never saw in the
list. The same happens for `unused:library` (it deletes library skills) and
for `plugin-unused:…`. After this part, an id made with a non-default window
carries the window, and `apply` uses it.

### Current state

- `src/health.ts`: `usageIssues` (starts at line 1273) builds the three usage
  issues. Its `uses.days` argument is the window.
- `src/commands.ts`: `USAGE_DAYS` (line 47) is the default window.
  `apply` (lines 712-741) finds an issue by id and runs a choice.
- `src/usage.ts`: transcript reading. `src/commands.ts` and
  `src/health.ts` can both import from it without a cycle.
- `skills/skilllib/SKILL.md`: the agents' manual. The "Fixes and decisions"
  paragraph tells agents to pass `apply` the same `--days`.

The default, `src/commands.ts:47`:

```ts
const USAGE_DAYS = 30;
```

The three ids in `src/health.ts`:

```ts
// line 1301
      id: `unused:${root}`,
// line 1340
        id: `plugin-unused:${installId(p)}`,
// line 1364
      id: "unused:library",
```

`apply`, `src/commands.ts:715-718`:

```ts
  // As status sees it here (this repo, even one skilllib hasn't seen yet), then as doctor does (every repo).
  // Only usage issues (`unused:…`, `plugin-unused:…`) need the transcripts, and they depend on --days: pass the one doctor had.
  const found = [...statusIssues(findProjectRoot()), ...(await allIssues(args, /^(plugin-)?unused:/.test(id)))].filter((i) => i.id === id);
  if (!found.length) throw new Error(`No issue ${id} right now (it may be fixed already; for an unused:… issue, pass doctor's --days). See skilllib status --json or doctor --json`);
```

`allIssues(args, withUsage)` (line 643) reads `args.days` and passes it to
`usageIssues` as `days`.

Who else reads these ids:

- The terminal app always uses 30 days (`src/tui/load.ts:656`, `days: 30`),
  so its ids do not change. `src/tui/world.ts:271-272` reads
  `found.id.split(":")[0]` and compares with `"unused:library"`; with the
  default window both still work.
- `src/health.test.ts:410-411` calls `usageIssues` with `days: 0` and expects
  the ids `unused:${project}` and `unused:library`. Step 4 updates these.
- `src/plugins.test.ts:470-477` uses `days: 30`: no change.

The sentence in `skills/skilllib/SKILL.md` ("Fixes and decisions" paragraph):

```
Ids come from `issues` in `status --json` (Now, below) or from `doctor --json` (every repo; pass `apply` the same `--days` you gave `doctor`).
```

Conventions to match: TypeScript strict, ESM, local imports end in `.js`, no
`any`. Comments are short and say why. Tests use `bun:test`; names are full
sentences. Issue ids are public strings: ids made with the default window
must stay exactly as they are.

### Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Type check | `pnpm type-check` | exit 0, no errors |
| Health tests | `bun test --timeout 20000 src/health.test.ts` | `0 fail` |
| Command tests | `bun test --timeout 20000 src/commands.test.ts` | `0 fail` |
| All tests | `pnpm test` | `0 fail` |

### Scope

**In scope**:
- `src/usage.ts` (one exported constant)
- `src/health.ts` (the three ids in `usageIssues`)
- `src/commands.ts` (`USAGE_DAYS` import, `apply`, one new exported helper)
- `src/health.test.ts` (two expected ids)
- `src/commands.test.ts` (one new test)
- `skills/skilllib/SKILL.md` (one sentence)

**Out of scope**:
- Any other issue id.
- `src/tui/*`. The app keeps its fixed 30 days.
- Choosing a choice by number against a list that changed since the agent saw
  it. That is a separate, larger problem (see Maintenance notes).
- `README.md`: plan 003 (part B) owns the docs.


### Steps

#### Step 1: Move the default window to `src/usage.ts`

1. In `src/usage.ts`, add near the top (after the imports):

```ts
/** The usual window for "used lately", in days: what --days defaults to. */
export const USAGE_DAYS = 30;
```

2. In `src/commands.ts`, delete `const USAGE_DAYS = 30;` (line 47) and add
   `USAGE_DAYS` to the existing import from `./usage.js` (line 35).

**Verify**: `pnpm type-check` → exit 0.

#### Step 2: Put a non-default window in the three ids

In `src/health.ts`:

1. Import `USAGE_DAYS` from `./usage.js` (add a new import line if the file
   has none from that module).
2. In `usageIssues`, after the line `const since = Date.now() - uses.days * 24 * 60 * 60 * 1000;` add:

```ts
  // An id from a window that isn't the usual one says so: `apply` then looks with that window, not the usual one
  // (a shorter window flags more skills than the list the user saw).
  const win = uses.days === USAGE_DAYS ? "" : `@${uses.days}`;
```

3. Change the three ids:
   - `` id: `unused:${root}`, `` → `` id: `unused${win}:${root}`, ``
   - `` id: `plugin-unused:${installId(p)}`, `` → `` id: `plugin-unused${win}:${installId(p)}`, ``
   - `id: "unused:library",` → `` id: `unused${win}:library`, ``

**Verify**: `pnpm type-check` → exit 0.

#### Step 3: Make `apply` read the window from the id

In `src/commands.ts`, add this exported helper directly before `apply`:

```ts
/** The usage window an issue id was made with: `unused@90:…` says 90 days; any other id, the window given. */
export function usageWindowOf(id: string, fallback: number): number {
  const window = id.match(/^(?:plugin-)?unused@(\d+):/)?.[1];
  return window ? Number(window) : fallback;
}
```

In `apply`, replace the two comment lines and the `const found = …` line with:

```ts
  // As status sees it here (this repo, even one skilllib hasn't seen yet), then as doctor does (every repo).
  // Only usage issues (`unused:…`, `plugin-unused:…`) need the transcripts. They depend on the window: the id carries
  // one that isn't the usual, so apply looks at the list doctor showed.
  const usage = /^(plugin-)?unused(@\d+)?:/.test(id);
  const found = [...statusIssues(findProjectRoot()), ...(await allIssues({ ...args, days: usageWindowOf(id, args.days) }, usage))].filter((i) => i.id === id);
```

In the next line, change the error text
`for an unused:… issue, pass doctor's --days` to
`an unused:… id from doctor --days N is unused@N:…`.

**Verify**: `pnpm type-check` → exit 0.

#### Step 4: Update the two expected ids in `src/health.test.ts`

At lines 410-411 the test passes `days: 0`. Change the expected ids:

- `` [`unused:${project}`, "web: 2 skills unused in 0 days"], `` → `` [`unused@0:${project}`, "web: 2 skills unused in 0 days"], ``
- `["unused:library", "1 skill in Your skills: in no repo, unused in 0 days"],` → `["unused@0:library", "1 skill in Your skills: in no repo, unused in 0 days"],`

**Verify**: `bun test --timeout 20000 src/health.test.ts` → `0 fail`.

#### Step 5: Add a test for the id contract

In `src/commands.test.ts`, add an import: `import { usageWindowOf } from "./commands.js";`
Add at the end of the file:

```ts
test("an unused issue's id carries a --days that isn't the usual, and apply reads it back", () => {
  expect(usageWindowOf("unused@90:/code/web", 30)).toBe(90);
  expect(usageWindowOf("plugin-unused@7:/code/web:tools@acme", 30)).toBe(7);
  expect(usageWindowOf("unused@90:library", 30)).toBe(90);
  // The usual window isn't written, so these ids are as they always were.
  expect(usageWindowOf("unused:/code/web", 30)).toBe(30);
  expect(usageWindowOf("tidy:/code/web", 45)).toBe(45);
});
```

**Verify**: `bun test --timeout 20000 src/commands.test.ts` → `0 fail`.

#### Step 6: Update the agents' manual

In `skills/skilllib/SKILL.md`, in the "Fixes and decisions" paragraph, replace

```
(every repo; pass `apply` the same `--days` you gave `doctor`)
```

with

```
(every repo; an id from `doctor --days N` is `unused@N:…`, so `apply` needs no `--days`)
```

**Verify**: `grep -c 'unused@N' skills/skilllib/SKILL.md` → `1`.

#### Step 7: Full check

**Verify**: `pnpm type-check && pnpm test` → exit 0, `0 fail`.

### Test plan

- `src/health.test.ts`: the updated expectation proves that a non-default
  window is written into the ids.
- `src/commands.test.ts`: the new test proves that `apply` reads it back and
  that default ids are unchanged.
- An end-to-end test (`doctor --days 90`, then `apply`) is not practical: it
  needs skill folders older than the window, and a test cannot set a folder's
  creation time.

### Done criteria

- [ ] `pnpm type-check` exits 0
- [ ] `pnpm test` exits 0 with `0 fail`
- [ ] `grep -n "const USAGE_DAYS" src/` -r shows exactly one line, in `src/usage.ts`
- [ ] `grep -c 'unused\${win}' src/health.ts` → `3`
- [ ] `git status --short` lists only the six in-scope files (and `plans/`)

### STOP conditions

Stop and report if:

- The excerpts in "Current state" do not match the live code.
- `grep -n "days:" src/tui/load.ts` shows a usage window other than `30`
  passed to `usageIssues`. Then the app's ids would change and
  `src/tui/world.ts` needs a decision from the maintainer.
- Importing from `./usage.js` in `src/health.ts` causes an import cycle error
  at test time.
- A test other than the two lines in step 4 fails because of an id.

### Maintenance notes

- Deferred: `apply <id> <n>` picks the n-th choice of a list that is rebuilt
  when `apply` runs. If the state changed since the agent read the list, the
  number can point at another choice. Labels are safe. A later plan can add a
  short content hash per issue and an `--expect` flag, or make `--json` mode
  accept labels only.
- If a new usage-based issue is added to `usageIssues`, its id needs the same
  `${win}` part and the regular expression in `usageWindowOf` must match it.
- Reviewer: confirm that ids from `doctor` with the default window are
  byte-for-byte the same as before.

---

## Part B: An interrupted run cannot leave a skill's version store broken

### Why this matters

Each change to a library skill becomes a new version: a folder
`~/.skilllib/store/<name>/<N>/` plus an entry in
`~/.skilllib/store/<name>/versions.json`. Today skilllib copies the folder
first and writes the index entry second. This happens inside ordinary read
commands such as `skilllib status`, the first time they run after a library
edit. If the run stops between the two writes (Ctrl-C, a crash, a full disk),
folder `<N>` exists but the index does not list it. From then on every command
that touches that skill fails with "exists but … doesn't list it: fix the
index". The error advises a manual index edit, which can record a half-copied
folder as a version. After this part a half copy never has the version's
name, and a whole copy that was left unrecorded is recorded on the next run.

### Current state

- `src/versions.ts` (about 90 lines): the version store. `latestVersion`
  (lines 53-76) records a new version when the library copy changed.
- `src/skills.ts`: `copySkill(from, to)` replaces `to` with a real copy of
  `from`. `treeHash(dir)` returns a content hash of a folder, or `null`.
- `src/paths.ts`: `writeState(path, data)` writes JSON through a temp file and
  a rename.
- `src/library.test.ts`: tests for the library and the store.

`latestVersion` today, `src/versions.ts:53-76`:

```ts
export function latestVersion(name: string): Version | null {
  if (latestCache.has(name)) return latestCache.get(name) ?? null;
  const source = join(libraryDir(), name);
  const hash = treeHash(source);
  let result: Version | null = null;
  if (hash) {
    const history = versionHistory(name);
    const last = history[history.length - 1];
    if (last?.hash === hash && existsSync(versionDir(name, last.version))) {
      result = last;
    } else {
      const next: Version = { version: (last?.version ?? 0) + 1, hash, date: new Date().toISOString() };
      // A stored version is immutable: never write over one, even if the index lost track of it.
      if (existsSync(versionDir(name, next.version))) throw new Error(`${versionDir(name, next.version)} exists but ${indexFile(name)} doesn't list it: fix the index before adding versions`);
      mkdirSync(storeDir(name), { recursive: true });
      copySkill(source, versionDir(name, next.version));
      const recorded = [...history, next];
      writeState(indexFile(name), recorded);
      historyCache.set(name, recorded);
      result = next;
    }
  }
  latestCache.set(name, result);
  return result;
}
```

Imports at the top of the file today:

```ts
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { libraryDir, readState, skilllibHome, writeState } from "./paths.js";
import { copySkill, treeHash } from "./skills.js";
```

Test helpers that already exist in `src/library.test.ts:19-27`:

```ts
function writeSkill(dir: string, body: string) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: x\ndescription: d\n---\n${body}\n`);
}

const lib = (name: string) => join(tmp, "home", "library", name);
```

In that file's `beforeEach`, `SKILLLIB_HOME` is `join(tmp, "home")`, so the
store of skill `alpha` is `join(tmp, "home", "store", "alpha")`. The file
already imports `forgetLatest`, `latestVersion`, `versionDir`,
`versionHistory` from `./versions.js`.

The existing test to model on, `src/library.test.ts:675-685`:

```ts
  test("a damaged version index is an error, and no stored version is written over", () => {
    writeSkill(join(tmp, "src", "alpha"), "v2");
    importSkill(join(tmp, "src", "alpha"), { force: true });
    expect(latestVersion("alpha")!.version).toBe(2);
    const index = join(tmp, "home", "store", "alpha", "versions.json");
    writeFileSync(index, readFileSync(index, "utf-8").slice(0, 20));
    forgetLatest();
    expect(() => versionHistory("alpha")).toThrow("isn't valid JSON");
    expect(() => latestVersion("alpha")).toThrow("isn't valid JSON");
    expect(readFileSync(join(tmp, "home", "store", "alpha", "1", "SKILL.md"), "utf-8")).toContain("v1");
  });
```

Conventions to match: TypeScript strict, ESM, local imports end in `.js`, no
`any`. Comments are short and say why. Test names are full sentences.

### Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Type check | `pnpm type-check` | exit 0, no errors |
| Library tests | `bun test --timeout 20000 src/library.test.ts` | `0 fail` |
| All tests | `pnpm test` | `0 fail` |

### Scope

**In scope**:
- `src/versions.ts`
- `src/library.test.ts`

**Out of scope**:
- A lock between two skilllib processes. Two runs at the same moment are a
  separate problem and need their own design.
- `src/skills.ts`, `src/paths.ts`.
- The layout of the store. Folder names `<N>` and `versions.json` stay.


### Steps

#### Step 1: Copy to a temp name, rename, then write the index

In `src/versions.ts`:

1. Change the first import to
   `import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";`
2. In `latestVersion`, replace these three lines

```ts
      // A stored version is immutable: never write over one, even if the index lost track of it.
      if (existsSync(versionDir(name, next.version))) throw new Error(`${versionDir(name, next.version)} exists but ${indexFile(name)} doesn't list it: fix the index before adding versions`);
      mkdirSync(storeDir(name), { recursive: true });
      copySkill(source, versionDir(name, next.version));
```

   with

```ts
      const dir = versionDir(name, next.version);
      // A stored version is immutable: never write over one. One that is whole but unlisted (a run stopped after
      // the copy, before the index) holds exactly this content: it only needs recording.
      const unlisted = () => {
        if (treeHash(dir) !== hash) throw new Error(`${dir} exists but ${indexFile(name)} doesn't list it, and it isn't your library's copy: move that folder away, then run skilllib again`);
      };
      if (existsSync(dir)) unlisted();
      else {
        mkdirSync(storeDir(name), { recursive: true });
        // Copied under another name, then renamed: a run that stops mid-copy leaves no half version named as one.
        const temp = join(storeDir(name), `.${next.version}.${process.pid}.tmp`);
        copySkill(source, temp);
        try {
          renameSync(temp, dir);
        } catch (err) {
          rmSync(temp, { recursive: true, force: true });
          // Another run recorded this version meanwhile: fine when it holds the same content.
          if (!existsSync(dir)) throw err;
          unlisted();
        }
      }
```

   Keep the next four lines (`const recorded = …` to `result = next;`) as
   they are.

**Verify**: `pnpm type-check` → exit 0.

#### Step 2: Add the tests

In `src/library.test.ts`, add `cpSync` to the `node:fs` import. Add these two
tests directly after the test "a damaged version index is an error, and no
stored version is written over":

```ts
  test("a version that was copied but never recorded (the run stopped) is recorded on the next run", () => {
    expect(latestVersion("alpha")!.version).toBe(1);
    writeSkill(lib("alpha"), "v2");
    // What a run leaves when it stops between the copy and the index.
    cpSync(lib("alpha"), join(tmp, "home", "store", "alpha", "2"), { recursive: true });
    forgetLatest();
    expect(latestVersion("alpha")).toMatchObject({ version: 2 });
    forgetLatest();
    expect(versionHistory("alpha").map((v) => v.version)).toEqual([1, 2]);
  });

  test("an unlisted version folder with other content is an error, and it is not written over", () => {
    expect(latestVersion("alpha")!.version).toBe(1);
    writeSkill(lib("alpha"), "v2");
    writeSkill(join(tmp, "home", "store", "alpha", "2"), "half a copy");
    forgetLatest();
    expect(() => latestVersion("alpha")).toThrow("exists but");
    expect(readFileSync(join(tmp, "home", "store", "alpha", "2", "SKILL.md"), "utf-8")).toContain("half a copy");
  });
```

These tests assume that the `beforeEach` of the `describe` block they are in
has already imported a skill `alpha` at version 1 (the neighbouring test
relies on the same thing). Put them in the same `describe` block.

**Verify**: `bun test --timeout 20000 src/library.test.ts` → `0 fail`, both
new test names pass.

#### Step 3: Full check

**Verify**: `pnpm type-check && pnpm test` → exit 0, `0 fail`.

### Test plan

- Test 1: the regression. Before step 1 it fails with "exists but … doesn't
  list it".
- Test 2: the immutability rule still holds for content that does not match.
- Not tested: a rename that fails because another run was faster. It needs
  two processes at the same moment.

### Done criteria

- [ ] `pnpm type-check` exits 0
- [ ] `pnpm test` exits 0 with `0 fail`; the two new tests pass
- [ ] `grep -c "renameSync(temp, dir)" src/versions.ts` → `1`
- [ ] `git status --short` lists only `src/versions.ts` and `src/library.test.ts` (and `plans/`)

### STOP conditions

Stop and report if:

- The excerpts in "Current state" do not match the live code.
- `latestVersion("alpha")` is not version 1 at the start of the new tests
  (the `describe` block's setup is different from what this part assumes).
- An existing test expects the old message text "fix the index before adding
  versions". Report the test; do not change it.
- `grep -rn '"store"' src --include='*.ts' | grep -v test` shows code other
  than `src/versions.ts:15` that lists the store folder. Such code could see
  the `.N.pid.tmp` folders.

### Maintenance notes

- A crash during the copy leaves a `.N.<pid>.tmp` folder in the store. Nothing
  reads it and nothing removes it. If that ever matters, remove such folders
  that are more than a day old at the start of `latestVersion`.
- Read commands (`status`, `doctor`) still write the store on their first run
  after a library edit. That is by design today.
- Reviewer: check that the index is still written only after the version
  folder has its final name.

---

## Part C: `--json` always prints one JSON line, also for `help`, in a terminal, and in a sandbox

### Why this matters

Agents call skilllib with `--json` and parse stdout. The contract is: stdout
has exactly one line of JSON. Three cases break it:

1. `add`, `sync` and `global move` write `~/.skilllib/projects.json` as a last
   step. In an agent sandbox that cannot write that folder, the command has
   already done its work and printed its result. Then the write fails, and a
   second line `{"error": …}` follows with exit code 1. `status` already
   guards against this; the other commands do not.
2. `skilllib help --json` prints the plain help text on stdout.
3. `skilllib --json` (no command) in a terminal opens the interactive app,
   which blocks an agent that runs under a terminal.

### Current state

- `src/index.ts`: the entry point. Parses the command and dispatches.
- `src/commands.ts`: the commands.
- `src/output.ts`: `json(output, data)` prints the one JSON line. Its
  `JsonOutputs` type maps each output name to a public type.
- `src/json.ts`: the public types of every `--json` output. Fields can be
  added; nothing is removed or changed outside a major version.

The guard that `status` has, `src/commands.ts:227-239`:

```ts
  if (args.json) {
    // The skilllib skill runs this wherever an agent is: outside a repo it lists the global skills.
    const root = findProjectRoot();
    const usage = await usageBySkill(args.days, root);
    json("status", usableHere(root, new Map([...usage].map(([name, u]) => [name, u.uses]))));
    // Remembering the repo is a convenience: a skilllib folder an agent's sandbox can't write must not add a second
    // JSON document (an error) after the one printed.
    try {
      if (projectHere()) rememberProjects([root]);
    } catch {
      // next time
    }
    return;
  }
```

The unguarded calls in `src/commands.ts`:

```ts
// line 305, end of the text-mode status
  rememberProjects([root]);
// line 426, end of `add`
  rememberProjects([root]);
// line 462, end of `sync`
  if (!args.all) rememberProjects(roots);
// line 1020, in `global move`, BEFORE its json(...) call
  rememberProjects(roots);
```

`rememberProjects` (`src/project.ts:419-427`) throws when it cannot write the
file. Other callers (`src/config.ts:91` for `scan`, `src/tui/load.ts:191`)
must keep failing loudly: do not change them.

The entry point, `src/index.ts:132-135` and `193-203`:

```ts
  switch (command) {
    case undefined:
      // Interactive when a person is at the terminal; plain status for scripts and pipes.
      return process.stdin.isTTY && process.stdout.isTTY ? (await import("./tui/index.js")).tui() : commands.overview(args);
```

```ts
    case "--version":
    case "-v":
    case "version":
      // With --json, still one JSON document: the version as a string.
      console.log(isJsonMode() ? JSON.stringify(packageVersion()) : packageVersion());
      return;
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      return;
```

`commands.overview(args)` (`src/commands.ts:309-312`) already prints
`status --json` when `args.json` is set. `src/index.ts` already imports
`isJsonMode` and `json` from `./output.js`.

The type map, `src/output.ts:37-59` (shortened):

```ts
type JsonOutputs = {
  status: StatusJson;
  …
  "agent-skill": AgentSkillJson;
  /** Any command that fails: exit code 1, and the reason (also on stderr). */
  error: ErrorJson;
};
```

The test helper, `src/commands.test.ts:15-19`:

```ts
/** Runs the CLI from source in `cwd` (not a terminal, so bare `skilllib` is the piped overview). */
function cli(cwd: string, ...args: string[]) {
  const r = spawnSync(process.execPath, [join(import.meta.dir, "index.ts"), ...args], { cwd, env: { ...process.env }, encoding: "utf-8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
```

In that file's `beforeEach`, `SKILLLIB_HOME` is `join(tmp, ".skilllib")` and a
library skill `alpha` exists. A test repo is made like this
(`src/commands.test.ts:108-109`). It is not a real git repo, so `add` pins in
`skilllib.json` there:

```ts
    const repo = join(tmp, "code", "web");
    mkdirSync(join(repo, ".git"), { recursive: true });
```

Conventions to match: TypeScript strict, ESM, local imports end in `.js`, no
`any`. Comments are short and say why. Test names are full sentences.

### Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Type check | `pnpm type-check` | exit 0, no errors |
| Command tests | `bun test --timeout 20000 src/commands.test.ts` | `0 fail` |
| All tests | `pnpm test` | `0 fail` |

### Scope

**In scope**:
- `src/commands.ts` (one helper, five call sites)
- `src/index.ts` (three `case` branches)
- `src/json.ts` (two new types)
- `src/output.ts` (two lines in `JsonOutputs`, one import)
- `src/commands.test.ts`

**Out of scope**:
- `src/project.ts`: `rememberProjects` itself keeps throwing.
- `src/config.ts:91` and `src/tui/load.ts:191`.
- `README.md` and `skills/skilllib/SKILL.md`: plan 003 (part B) owns the docs.
- The HELP text.


### Steps

#### Step 1: One quiet "remember" helper in `src/commands.ts`

Add this function directly before `export async function status`:

```ts
/**
 * Remembering a repo is a convenience. A skilllib folder that can't be written (an agent's sandbox) must not fail a
 * command that did its work, or add a second JSON document (an error) after the one printed.
 */
function rememberQuietly(roots: string[]) {
  try {
    rememberProjects(roots);
  } catch {
    // next time
  }
}
```

Then:

1. In `status` (JSON branch), replace the comment and the `try { … } catch { … }`
   block with one line: `if (projectHere()) rememberQuietly([root]);`
2. Line 305: `rememberProjects([root]);` → `rememberQuietly([root]);`
3. Line 426 (`add`): `rememberProjects([root]);` → `rememberQuietly([root]);`
4. Line 462 (`sync`): `if (!args.all) rememberProjects(roots);` → `if (!args.all) rememberQuietly(roots);`
5. Line 1020 (`global move`): `rememberProjects(roots);` → `rememberQuietly(roots);`

**Verify**: `pnpm type-check` → exit 0, and
`grep -c "rememberProjects(" src/commands.ts` → `1` (only inside the helper).

#### Step 2: Typed JSON for `help` and `version`

1. In `src/json.ts`, add at the end of the file:

```ts
/** `skilllib help --json`: the help text. */
export type HelpJson = { help: string };

/** `skilllib --version --json`: the version, as a JSON string. */
export type VersionJson = string;
```

2. In `src/output.ts`, add `HelpJson` and `VersionJson` to the type import
   from `./json.js`, and add two lines to `JsonOutputs` before the `error`
   entry:

```ts
  help: HelpJson;
  version: VersionJson;
```

3. In `src/index.ts`, replace the bodies of the two branches:

```ts
    case "--version":
    case "-v":
    case "version":
      // With --json, still one JSON document: the version as a string.
      if (isJsonMode()) json("version", packageVersion());
      else console.log(packageVersion());
      return;
    case "help":
    case "--help":
    case "-h":
      // With --json, still one JSON document.
      if (isJsonMode()) json("help", { help: HELP });
      else console.log(HELP);
      return;
```

**Verify**: `pnpm type-check` → exit 0.

#### Step 3: `--json` never opens the app

In `src/index.ts`, change the `case undefined:` branch to:

```ts
    case undefined:
      // Interactive when a person is at the terminal; plain status for scripts and pipes, and whenever --json asks.
      return !isJsonMode() && process.stdin.isTTY && process.stdout.isTTY ? (await import("./tui/index.js")).tui() : commands.overview(args);
```

**Verify**: `pnpm type-check` → exit 0.

#### Step 4: Tests

In `src/commands.test.ts`, add `chmodSync` to the `node:fs` import. Add these
tests at the end of the file:

```ts
test("help --json is one line of JSON", () => {
  const r = cli(tmp, "help", "--json");
  expect(r.code).toBe(0);
  expect(r.out.trim().split("\n")).toHaveLength(1);
  expect(JSON.parse(r.out).help).toContain("skilllib install");
});

// A read-only folder can't be made on Windows this way, and root can write anywhere.
test.skipIf(process.platform === "win32" || process.getuid?.() === 0)("add --json in a sandbox that can't write ~/.skilllib still prints one result and exits 0", () => {
  const repo = join(tmp, "code", "web");
  mkdirSync(join(repo, ".git"), { recursive: true });
  const home = join(tmp, ".skilllib");
  chmodSync(home, 0o555);
  try {
    const r = cli(repo, "add", "alpha", "--json");
    expect(r.out.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(r.out)[0]).toMatchObject({ name: "alpha", action: "installed" });
    expect(r.code).toBe(0);
  } finally {
    chmodSync(home, 0o755);
  }
});
```

Before step 1, the second test fails: stdout has two lines and the exit code
is 1. That is the bug.

**Verify**: `bun test --timeout 20000 src/commands.test.ts` → `0 fail`.

#### Step 5: Full check

**Verify**: `pnpm type-check && pnpm test` → exit 0, `0 fail`.

### Test plan

- `help --json`: one line, parses, holds the help text.
- The sandbox case for `add`.
- Not tested: `skilllib --json` in a terminal. A test process has no terminal.
  Check step 3 by reading the code.

### Done criteria

- [ ] `pnpm type-check` exits 0
- [ ] `pnpm test` exits 0 with `0 fail`; the two new tests pass
- [ ] `grep -c "rememberProjects(" src/commands.ts` → `1`
- [ ] `grep -c "console.log(HELP)" src/index.ts` → `2` (the text branch of `help`, and the unknown-command branch)
- [ ] `grep -c "!isJsonMode() && process.stdin.isTTY" src/index.ts` → `1`
- [ ] `git status --short` lists only the five in-scope files (and `plans/`)

### STOP conditions

Stop and report if:

- The excerpts in "Current state" do not match the live code.
- The sandbox test fails after step 1 with an error that names a path other
  than `projects.json`. Then `add` writes another file in `~/.skilllib`, and
  the maintainer must decide if that write is also optional. Report the path.
- The sandbox test is flaky (passes and fails on repeated runs). Remove that
  one test, keep the code change, and say so in your report.

### Maintenance notes

- Every new command that calls `rememberProjects` after it prints JSON must
  use `rememberQuietly`.
- `HelpJson` and `VersionJson` are now public types. Plan 003 (part B) adds `help` and
  `version` to the list of `--json` commands in the README.
- Plan 002 (part D) adds a contract test for every command.
- Reviewer: check that `scan` (through `src/config.ts`) still fails loudly
  when it cannot write.

---

## Part D: One test checks the `--json` contract of every command

### Why this matters

Agents are the main user of skilllib. They rely on one contract for every
command with `--json`:

- stdout has exactly one line, and it is JSON;
- the exit code is 1 when the command could not do all that was asked;
- a stopping error prints `{"error": "…"}` on stdout and exits 1.

Today each test checks one command's data. No test checks the contract
itself for every command. Three contract bugs passed the full suite (plan 001
part B, and parts A and C of this plan, fix them). This part adds one table-driven test, so a new
command or a regression fails CI.

### Current state

- `src/index.ts`: the entry point. `FLAGS_OF` (lines 76-108) lists every
  command.
- `src/output.ts`: `json()` prints the one line. In JSON mode, messages go to
  stderr.
- `src/commands.test.ts`: existing CLI tests. Its setup is the pattern to
  copy.

Commands that print JSON with `--json` (from the help text in
`src/index.ts:59-60` and the code): `status`, `list`, `show`, `projects`,
`outdated`, `usage`, `doctor`, `apply`, `add`, `remove`, `sync`, `update`,
`import`, `global move`, `agent-skill`, `install`, `search`, `check`,
`plugin`, plus `help` and `version` (after plan 002 (part C)).

Commands that print messages only, by design (do NOT put them in the table):
`link`, `tidy`, `global` (listing, `keep`, `unkeep`), `restore`, `new`,
`folders`, `harnesses`, `scan`, `unhide`.

The setup to copy, `src/commands.test.ts:1-43`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readConfig, setHarnesses, setHidden } from "./config.js";
import { importSkill } from "./library.js";

let tmp: string;
const realHome = process.env.HOME;
// Node reads the home folder from USERPROFILE on Windows, HOME elsewhere.
const realProfile = process.env.USERPROFILE;

/** Runs the CLI from source in `cwd` (not a terminal, so bare `skilllib` is the piped overview). */
function cli(cwd: string, ...args: string[]) {
  const r = spawnSync(process.execPath, [join(import.meta.dir, "index.ts"), ...args], { cwd, env: { ...process.env }, encoding: "utf-8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), "skilllib-commands-")));
  process.env.HOME = tmp;
  process.env.USERPROFILE = tmp;
  process.env.SKILLLIB_HOME = join(tmp, ".skilllib");
  process.env.CLAUDE_CONFIG_DIR = join(tmp, ".claude");
  delete process.env.CODEX_HOME;
  setHarnesses(["claude-code", "codex"]);
  mkdirSync(join(tmp, "src", "alpha"), { recursive: true });
  writeFileSync(join(tmp, "src", "alpha", "SKILL.md"), "---\ndescription: d\n---\nbody\n");
  importSkill(join(tmp, "src", "alpha"));
  …
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  process.env.HOME = realHome;
  if (realProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = realProfile;
  delete process.env.CLAUDE_CONFIG_DIR;
});
```

The documented exit-code rule (`README.md`, section "Command line"): a command
exits 1 when it could not do all you asked, for example a skill skipped
because it is not in the library.

The repo rule for tests: test behavior that can break. Do not test getters,
constants or pass-through code. This test is about a contract between
skilllib and agents, so it qualifies.

Conventions to match: TypeScript strict, ESM, local imports end in `.js`, no
`any`. Test names are full sentences.

### Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Type check | `pnpm type-check` | exit 0, no errors |
| The new file | `bun test --timeout 20000 src/contract.test.ts` | `0 fail` |
| All tests | `pnpm test` | `0 fail` |

### Scope

**In scope**:
- `src/contract.test.ts` (create)

**Out of scope**:
- Any file under `src/` that is not a test. If a row fails because of a
  product bug, do not fix the product here (see STOP conditions).
- `src/commands.test.ts`: do not move tests out of it.


### Steps

#### Step 1: Create `src/contract.test.ts` with the setup

Copy the imports you need, `cli`, `beforeEach` and `afterEach` from
`src/commands.test.ts` (shown above). In `beforeEach`, after
`importSkill(...)`, also create the repo that the rows run in:

```ts
  repo = join(tmp, "code", "web");
  mkdirSync(join(repo, ".git"), { recursive: true });
```

Declare `let repo: string;` next to `let tmp: string;`. Use the prefix
`"skilllib-contract-"` for the temp folder.

**Verify**: `pnpm type-check` → exit 0.

#### Step 2: Add the table and the loop

```ts
type Row = {
  /** What the row shows, for the test's name. */
  name: string;
  /** Commands to run first (without --json checks), each in the repo. */
  before?: string[][];
  args: string[];
  /** The exit code the contract gives. */
  code: 0 | 1;
  /** A stopping error: stdout is {"error": "..."}. */
  error?: true;
  /** Extra environment for this row. */
  env?: Record<string, string>;
};

// The table is read once when the file loads, for the tests' names: `tmp` isn't set yet then.
const src = () => join(tmp ?? "", "src", "alpha");

const rows: (() => Row)[] = [
  () => ({ name: "status", args: ["status"], code: 0 }),
  () => ({ name: "list", args: ["list"], code: 0 }),
  () => ({ name: "show", args: ["show", "alpha"], code: 0 }),
  () => ({ name: "show of an unknown skill", args: ["show", "nope"], code: 1, error: true }),
  () => ({ name: "projects", args: ["projects"], code: 0 }),
  () => ({ name: "outdated", args: ["outdated"], code: 0 }),
  () => ({ name: "usage", args: ["usage"], code: 0 }),
  () => ({ name: "doctor", args: ["doctor"], code: 0 }),
  () => ({ name: "check", args: ["check"], code: 0 }),
  () => ({ name: "agent-skill", args: ["agent-skill"], code: 0 }),
  () => ({ name: "version", args: ["version"], code: 0 }),
  () => ({ name: "help", args: ["help"], code: 0 }),
  () => ({ name: "add", args: ["add", "alpha"], code: 0 }),
  () => ({ name: "add of a skill the library doesn't have", args: ["add", "nope"], code: 1 }),
  () => ({ name: "remove", before: [["add", "alpha"]], args: ["remove", "alpha"], code: 0 }),
  () => ({ name: "remove of a skill the repo doesn't have", args: ["remove", "alpha"], code: 1 }),
  () => ({ name: "sync", before: [["add", "alpha"]], args: ["sync"], code: 0 }),
  () => ({ name: "update", before: [["add", "alpha"]], args: ["update"], code: 0 }),
  () => ({ name: "import", args: ["import", src()], code: 0 }),
  () => ({ name: "import of a folder with no SKILL.md", args: ["import", join(tmp ?? "", "src")], code: 1 }),
  () => ({ name: "install from a folder", args: ["install", src()], code: 0 }),
  () => ({ name: "apply of an unknown issue", args: ["apply", "nope:1"], code: 1, error: true }),
  () => ({ name: "plugin off for an unknown plugin", args: ["plugin", "off", "nope@nowhere"], code: 1 }),
  () => ({ name: "an unknown flag", args: ["status", "--nope"], code: 1, error: true }),
  () => ({ name: "an unknown command", args: ["nope"], code: 1, error: true }),
  // Nothing listens on port 1, so the search fails at once: the error path, with no network.
  () => ({ name: "search when skills.sh can't be reached", args: ["search", "react"], code: 1, error: true, env: { SKILLLIB_SKILLS_API: "http://127.0.0.1:1" } }),
];

describe("--json: one line of JSON on stdout, and the exit code says whether all of it was done", () => {
  for (const make of rows) {
    const name = make().name;
    test(name, () => {
      const row = make();
      for (const args of row.before ?? []) cli(repo, ...args);
      const r = cliWith(row.env ?? {}, repo, ...row.args, "--json");
      // The name first, so a failure says which row it was.
      expect([row.name, r.out.endsWith("\n"), r.out.trim().split("\n").length]).toEqual([row.name, true, 1]);
      const data = JSON.parse(r.out);
      expect([row.name, r.code]).toEqual([row.name, row.code]);
      // A result can be a string (version) or a list: only a plain object can be the error document.
      const isError = typeof data === "object" && data !== null && !Array.isArray(data) && "error" in data;
      expect([row.name, isError]).toEqual([row.name, row.error === true]);
      if (row.error) expect(Object.keys(data)).toEqual(["error"]);
    });
  }
});
```

`make()` is called when the file loads, only for the name. `tmp` is not set
then, which is why the paths use `tmp ?? ""`. The test body calls `make()`
again after `beforeEach`, and gets the real paths.

Add `cliWith` next to `cli`:

```ts
function cliWith(env: Record<string, string>, cwd: string, ...args: string[]) {
  const r = spawnSync(process.execPath, [join(import.meta.dir, "index.ts"), ...args], { cwd, env: { ...process.env, ...env }, encoding: "utf-8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
```

**Verify**: `pnpm type-check` → exit 0.

#### Step 3: Add the row that plan 001 (part B) fixed

Add one test after the loop, inside the same `describe`:

```ts
  test("install of a skill the library has another version of", () => {
    writeFileSync(join(src(), "SKILL.md"), "---\ndescription: d\n---\nanother body\n");
    const r = cli(repo, "install", src(), "--json");
    expect(r.out.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(r.out)[0]).toMatchObject({ name: "alpha", status: "exists" });
    expect(r.code).toBe(1);
  });
```

**Verify**: `bun test --timeout 20000 src/contract.test.ts` → see step 4.

#### Step 4: Run it and settle each failing row

Run `bun test --timeout 20000 src/contract.test.ts`. For each row that fails,
decide with these rules. Do not use any other rule.

1. **stdout is not one line, or not JSON** → this is a product bug. Change
   that row to `test.todo("<name>: <what you saw>")`, and list it in your
   report. Do not fix the product.
2. **The exit code differs from `code`, and the output is one valid JSON
   line** → read the JSON. If it shows that the command did all that was
   asked (for example `doctor` exits 1 because it found problems in the
   sandbox, or `plugin off` reports `ok: false` differently), correct `code`
   or `error` in the row to what the command does, and add the row's name and
   your reason to the commit message body. If it shows work that was not
   done but exit 0, treat it as rule 1.
3. **The `search` row takes more than 5 seconds** → remove that row and say
   so in your report.

**Verify**: `bun test --timeout 20000 src/contract.test.ts` → `0 fail`. The
output lists at most 3 `todo` tests.

#### Step 5: Full check

**Verify**: `pnpm type-check && pnpm test` → exit 0, `0 fail`. Note the total
run time; it must stay under 90 seconds on your machine (it was about 30
seconds before this part).

### Test plan

- 26 table rows plus one extra test. Each spawns the CLI once or twice.
- Pattern: `src/commands.test.ts`.

### Done criteria

- [ ] `pnpm type-check` exits 0
- [ ] `pnpm test` exits 0 with `0 fail`
- [ ] `bun test --timeout 20000 src/contract.test.ts` reports at least 24 passing tests and at most 3 `todo`
- [ ] `git status --short` lists only `src/contract.test.ts` (and `plans/`)
- [ ] Your report lists every row you changed under rule 2 and every `todo`

### STOP conditions

Stop and report if:

- Plans 001 (part B) and 002 (part C) are not in the branch (`grep -c "rememberQuietly" src/commands.ts`
  returns `0`, or `grep -c 'json("help"' src/index.ts` returns `0`).
- More than 3 rows end as `todo`. That means a broader problem than this part
  assumes.
- A row fails only on Windows or only on Linux in CI and passes locally.
  Report the row and the output.

### Maintenance notes

- A new command with `--json` needs a row here. Plan 003 (part C) (`AGENTS.md`) records
  that rule.
- The table checks the shape of the contract, not the data. The data of each
  command is tested in `src/commands.test.ts` and others.
- Each row spawns a process. If the suite gets slow, group read-only rows
  (`status`, `list`, `show`, `projects`) into one test that shares a sandbox.
