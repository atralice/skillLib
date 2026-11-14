# Plan 001: `skilllib install` is safe, names skills correctly, and reports failures

> **Executor instructions**: This plan has four parts (A to D). Do them in
> order. Follow each part step by step. Run every verification command and
> confirm the expected result before you go to the next step. Make one commit
> at the end of each part, after that part's "Done criteria" hold. If a "STOP
> condition" of any part occurs, stop the whole plan and report which parts
> are committed. Do not improvise. When all parts are done, update the status
> row for this plan in `plans/README.md`, unless a reviewer dispatched you and
> told you they maintain the index.
>
> **Drift check (run first)**: `git diff --stat da9073a..HEAD -- src/install.ts src/install.test.ts src/commands.ts src/json.ts src/skills.ts skills/skilllib/SKILL.md`
> If a listed file changed, compare the "Current state" excerpts of each part
> with the live code before you start that part. A mismatch in an excerpt is a
> STOP condition. Shifted line numbers alone are not. Changes that an earlier
> part of this plan made are expected.

## Status

- **Priority**: P1
- **Effort**: M (four parts, each S)
- **Risk**: LOW
- **Depends on**: none
- **Category**: security, bug
- **Planned at**: commit `da9073a`, 2026-11-11

## Why this matters

`skilllib install` (new in version 1.13) downloads skills from GitHub and
skills.sh. It is the newest code in the repo and has the fewest tests. The
audit found four problems in it: a downloaded skill can copy a file from
outside its repo into the user's library; `install --json` exits 0 when
nothing was installed; a repo that is one skill gets the wrong name; and the
network calls have no timeout. All four are in the same two files, so one
executor does them in sequence.

## Parts

| Part | What | Commit message |
|---|---|---|
| A | A downloaded skill cannot copy files from outside its repo | `fix: install leaves out links that point outside the downloaded repo` |
| B | `install --json` exits 1 when a skill was not installed, and says where the pin went | `fix: install --json exits 1 when a skill wasn't installed, and says when the pin is personal` |
| C | A repo that is one skill is installed under the skill's name | `fix: install names a repo that is one skill after the skill, not the archive folder` |
| D | `install` and `search` time out, honor a branch in the URL, and clean up | `fix: install and search time out, a tree URL installs its branch, and a failed install leaves no temp folder` |

## Git workflow

- Work in a git worktree of your own (`git worktree add <folder> -b advisor/001-install-hardening origin/main`). If `git status --short` shows changed files that you did not make, STOP: do not switch branches, stash or commit in that checkout.
- One branch for the whole plan. One commit for each part, with the message from the table above. Conventional Commits, as in `git log` (example from this repo: `fix: personal skills stay out of git through linked skills folders`).
- Do not edit `version` in `package.json` or `CHANGELOG.md`: release-please owns them.
- Do NOT push or open a PR unless the operator told you to.

## Done criteria for the whole plan

- [ ] Each part's own "Done criteria" held before its commit. A part's `git status --short` check is made before that part's commit.
- [ ] `git log --oneline origin/main..HEAD` shows four commits, in the order A, B, C, D
- [ ] `pnpm type-check` exits 0 and `pnpm test` reports `0 fail` on the last commit
- [ ] `plans/README.md` status row updated

---

## Part A: A downloaded skill cannot copy files from outside its repo

### Why this matters

`skilllib install owner/repo` downloads a GitHub archive and extracts it with
`tar`. `tar` keeps symlinks. A skill folder in the archive can hold a symlink
that points to a file outside the download, for example a file in the user's
home folder. skilllib then copies the skill with "follow links" on. The
content of the outside file lands in `~/.skilllib/library/<skill>` and in the
repo's skill folder. The user can then commit it. After this part, links that
leave the download are removed before any copy, and the user gets a warning.

### Current state

- `src/install.ts`: download and install logic. `downloadGitHub` (lines
  110-157) fetches and extracts the archive. `resolveInstallDir` (lines
  242-253) finds the skill folders.
- `src/skills.ts`: `copySkill` (lines 72-80) copies a skill folder and
  **follows** symlinks on purpose. Do not change it.
- `src/commands.ts`: `install` (lines 1171-1252) is the CLI command. It calls
  `resolveInstallDir`.
- `src/install.test.ts`: tests for install (93 lines).

Extraction today, `src/install.ts:147-157`:

```ts
    execFileSync("tar", ["-xzf", archive, "-C", dest], { stdio: "ignore" });
  } catch (err) {
    rmSync(dest, { recursive: true, force: true });
    if (err instanceof Error && /larger than|couldn't download/.test(err.message)) throw err;
    throw new Error(`couldn't extract ${owner}/${repo}`);
  }
  rmSync(archive, { force: true });
  const top = readdirSync(dest);
  const root = top.length === 1 && statSync(join(dest, top[0]!)).isDirectory() ? join(dest, top[0]!) : dest;
  return { tmp: dest, root };
}
```

The copy that follows links, `src/skills.ts:78-79` (context only):

```ts
  const loops = (src: string) => src !== source && ((r) => r === source || source.startsWith(r + sep))(realpathSync(src));
  cpSync(source, to, { recursive: true, dereference: true, filter: (src) => !IGNORED.has(basename(src)) && existsSync(src) && !loops(src) });
```

The end of `resolveInstallDir`, `src/install.ts:249-253`:

```ts
  const got = await downloadGitHub(spec.owner, spec.repo);
  const source = spec.skill ? `${spec.owner}/${spec.repo}@${spec.skill}` : `${spec.owner}/${spec.repo}`;
  const dirs = skillNamed(findSkillDirs(got.root), spec.skill);
  return { tmp: got.tmp, dirs, source, many: !spec.skill && dirs.length > 1 };
}
```

`src/install.ts` already has this helper at lines 77-82. Reuse its logic:

```ts
function escapes(root: string, path: string): boolean {
  const base = realpathOrNull(root);
  const real = realpathOrNull(path);
  if (!base || !real) return true;
  return real !== base && !real.startsWith(base + sep);
}
```

Conventions to match:

- TypeScript strict, ESM. Local imports end in `.js`. No `any`.
- Comments are short and say why. See the comments in `src/skills.ts`.
- Tests use `bun:test`. Each test file points `HOME` and `SKILLLIB_HOME` at a
  temp folder in `beforeEach` (see `src/install.test.ts:20-28`).
- Test names are full sentences that state the behavior.
- A test that makes symlinks uses `test.skipIf(process.platform === "win32")`
  (example: `src/library.test.ts:604`).
- Messages to the user go through `warn`, `info`, `error` from
  `src/output.ts`. In `--json` mode these go to stderr.

### Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install deps | `pnpm install --frozen-lockfile` | exit 0 |
| Type check | `pnpm type-check` | exit 0, no errors |
| One test file | `bun test --timeout 20000 src/install.test.ts` | `0 fail` |
| All tests | `pnpm test` | `0 fail` (413 pass at planning time, about 30 s) |

### Scope

**In scope** (the only files you modify):
- `src/install.ts`
- `src/commands.ts` (only the `install` function)
- `src/install.test.ts`

**Out of scope** (do NOT touch):
- `src/skills.ts`. `copySkill` follows links on purpose: many global skills
  are links into `~/.agents/skills`. A change there affects every copy path.
- `findSkillDirs` in `src/install.ts`. It also serves local folders, where a
  link chosen by the user is legitimate.
- `package.json` version, `CHANGELOG.md`: release-please owns them.


### Steps

#### Step 1: Add `dropOutsideLinks` to `src/install.ts`

Add this exported function after `escapes` (after line 82). Add `unlinkSync`
to the `node:fs` import on line 2.

```ts
/**
 * Removes every link under `root` that points outside `root`, or at nothing. For downloaded content only:
 * copySkill follows links, so a link out of the download would copy a file of the user's into the library.
 * The link is removed, never what it points to. Returns the links removed.
 */
export function dropOutsideLinks(root: string): string[] {
  const base = realpathOrNull(root);
  if (!base) return [];
  const dropped: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const st = lstatSync(path);
      if (st.isSymbolicLink()) {
        if (escapes(base, path)) {
          unlinkSync(path);
          dropped.push(path);
        }
        // A link that stays inside the download isn't followed here: its target is walked where it really is.
      } else if (st.isDirectory()) walk(path);
    }
  };
  walk(base);
  return dropped;
}
```

**Verify**: `pnpm type-check` → exit 0.

#### Step 2: Call it after extraction

In `downloadGitHub`:

1. Change the return type to `Promise<{ tmp: string; root: string; dropped: number }>`.
2. After `rmSync(archive, { force: true });` add:
   `const dropped = dropOutsideLinks(dest).length;`
3. Change the last line to `return { tmp: dest, root, dropped };`.

In `resolveInstallDir`:

1. Add `dropped?: number` to the return type.
2. Change the GitHub return to
   `return { tmp: got.tmp, dirs, source, many: !spec.skill && dirs.length > 1, dropped: got.dropped };`

**Verify**: `pnpm type-check` → exit 0.

#### Step 3: Warn the user in `src/commands.ts`

In `install`, directly after the `try { resolved = await resolveInstallDir(spec); } catch { … continue; }`
block (the block that ends near line 1202), add:

```ts
    // Said, not silent: a skill that relied on such a link may miss a file.
    if (resolved.dropped) warn(`${resolved.source}: left out ${resolved.dropped} ${resolved.dropped === 1 ? "link that points" : "links that point"} outside the repo`);
```

`warn` is already imported in `src/commands.ts`. In `--json` mode it writes to
stderr, so stdout stays one JSON line.

**Verify**: `pnpm type-check` → exit 0.

#### Step 4: Add the test

In `src/install.test.ts`:

- Add `symlinkSync` to the `node:fs` import.
- Add `dropOutsideLinks` to the import from `./install.js`.
- Add `librarySkillDir` to the import from `./library.js`.

Add this test inside `describe("install", …)`:

```ts
  test.skipIf(process.platform === "win32")("a downloaded repo's links that point outside it are left out, and the files they point to stay", () => {
    const dl = join(tmp, "dl");
    skill(join(dl, "repo", "leaky"), "leaky");
    mkdirSync(join(dl, "repo", "shared"));
    writeFileSync(join(dl, "repo", "shared", "ref.md"), "inside");
    writeFileSync(join(tmp, "outside.txt"), "private");
    mkdirSync(join(tmp, "outside-dir"));
    writeFileSync(join(tmp, "outside-dir", "a.txt"), "private");
    symlinkSync(join(tmp, "outside.txt"), join(dl, "repo", "leaky", "file-out"));
    symlinkSync(join(tmp, "outside-dir"), join(dl, "repo", "leaky", "dir-out"));
    symlinkSync(join(tmp, "nothing-here"), join(dl, "repo", "leaky", "dangling"));
    symlinkSync(join(dl, "repo", "shared", "ref.md"), join(dl, "repo", "leaky", "ref.md"));

    expect(dropOutsideLinks(dl).map((p) => basename(p)).sort()).toEqual(["dangling", "dir-out", "file-out"]);
    expect(readFileSync(join(tmp, "outside.txt"), "utf-8")).toBe("private");
    expect(existsSync(join(tmp, "outside-dir", "a.txt"))).toBe(true);

    importSkill(join(dl, "repo", "leaky"));
    const inLibrary = librarySkillDir("leaky");
    expect(existsSync(join(inLibrary, "file-out"))).toBe(false);
    expect(existsSync(join(inLibrary, "dir-out"))).toBe(false);
    expect(readFileSync(join(inLibrary, "ref.md"), "utf-8")).toBe("inside");
  });
```

**Verify**: `bun test --timeout 20000 src/install.test.ts` → `0 fail`, and the
new test name appears in the output as passed.

#### Step 5: Full check

**Verify**: `pnpm type-check && pnpm test` → exit 0, `0 fail`.

### Test plan

- One new test (step 4). It covers: a file link out, a folder link out, a
  dangling link, a link that stays inside the download, and that link targets
  are never deleted.
- Pattern: the existing tests in `src/install.test.ts`.
- The network path (`downloadGitHub`) has no test: the suite has no network.

### Done criteria

- [ ] `pnpm type-check` exits 0
- [ ] `pnpm test` exits 0 with `0 fail`
- [ ] `grep -n "dropOutsideLinks" src/install.ts` shows the definition and one call inside `downloadGitHub`
- [ ] `git status --short` lists only `src/install.ts`, `src/commands.ts`, `src/install.test.ts` (and `plans/`)

### STOP conditions

Stop and report if:

- The excerpts in "Current state" do not match the live code.
- `librarySkillDir` is not exported from `src/library.ts`.
- The new test fails twice after a reasonable fix attempt.
- A fix seems to need a change in `src/skills.ts`.

### Maintenance notes

- Only downloads are filtered. A local `skilllib install ./folder` and
  `skilllib import` still follow links inside a skill. That is deliberate
  today. If the maintainer wants the same rule for every source, the place is
  `copySkill` and `listFiles` in `src/skills.ts`, and it needs its own plan:
  some users link shared files into their skills.
- `findSkillDirs` has dead code: line 87 compares a folder with itself, and
  line 98 can never be true because `lstat` says a link is not a folder.
  Harmless. Left alone here.
- Reviewer: check that `unlinkSync` is used (it removes the link) and never a
  recursive remove.

---

## Part B: `install --json` exits 1 when a skill was not installed, and says where the pin went

### Why this matters

Agents run `skilllib install … --json` and read the exit code. The documented
contract is: a command exits 1 when it could not do all that was asked. Today
`install --json` exits 0 when the library already has a different version of
the skill, or when the skill was skipped. The agent then reports success for
an install that did not happen. Also, after an install in a repo the text
output says "Commit skilllib.json and the skill folders." even when the pin is
personal and no `skilllib.json` exists. And the JSON row does not say whether
the pin is personal, so an agent cannot know if there is something to commit.

### Current state

- `src/commands.ts`: `install` (lines 1171-1252). Sets the exit code and
  prints the result.
- `src/install.ts`: `installFound` (lines 208-239) builds the result rows.
- `src/json.ts`: public types of every `--json` output. `InstallJson` is at
  lines 194-203.
- `skills/skilllib/SKILL.md`: the manual that agents read. Line 47 describes
  `install`.

The exit code is set only in text mode, `src/commands.ts:1231-1252`:

```ts
      results.push(...installed);
      if (!args.json) {
        for (const row of installed) {
          if (row.status === "exists" || row.status === "skipped") {
            process.exitCode = 1;
            warn(`${row.name}: ${row.reason}`);
          } else {
            const where = row.global ? `global ${row.global.map((d) => tildify(d)).join(", ")}` : row.project ? `this project (${row.project.action})` : "your library";
            success(`${row.name} ${row.status === "unchanged" ? "already in your library" : "installed"} → ${where}`);
          }
        }
        if (!args.global && !projectHere() && installed.some((r) => r.status !== "exists" && r.status !== "skipped")) {
          info(dim("Not in a project, so nothing was added here. In a repo: skilllib add <name>. Everywhere: skilllib install <source> --global"));
        }
      }
    } finally {
      if (resolved.tmp) rmSync(resolved.tmp, { recursive: true, force: true });
    }
  }
  if (args.json) json("install", results);
  else if (results.some((r) => r.project && r.project.action !== "skipped")) info(dim("Commit skilllib.json and the skill folders."));
}
```

Helpers that already exist in `src/commands.ts` (reuse them):

```ts
// src/commands.ts:118-127
function withDirs(root: string, changes: Change[]): ChangeJson[] { … }   // adds `dirs` and `personal` to a change

// src/commands.ts:130
const incomplete = (c: Change) => c.action === "skipped" || !!c.blocked?.length || !!c.uncommitted?.length || !!c.inTheWay?.length;
```

How `add` words the same hint, `src/commands.ts:423-425` (match this wording):

```ts
  if (!args.json && args.personal === undefined && done.some((c) => c.action === "installed" && !c.moved && pins[c.name]!.personal))
    info(dim(`Pinned for you (${tildify(personalPinsDir())}), kept out of git. To share it with the team: skilllib add <name> --shared, then commit skilllib.json and the skill folders.`));
```

The public type today, `src/json.ts:194-203`:

```ts
/** `skilllib install --json` */
export type InstallJson = {
  name: string;
  source: string;
  status: "added" | "updated" | "unchanged" | "exists" | "skipped";
  reason?: string;
  project?: Change;
  /** Global folders written, when `--global`. */
  global?: string[];
}[];
```

`ChangeJson` (same file, lines 123-129) is `Change` plus optional `dirs` and
`personal`. Changing `project?: Change` to `project?: ChangeJson` only adds
optional fields. The rule for `src/json.ts`: fields can be added; a field is
removed or changed only in a major version.

Conventions to match: TypeScript strict, ESM, local imports end in `.js`, no
`any`. Tests use `bun:test` with `HOME` and `SKILLLIB_HOME` in a temp folder.
Test names are full sentences.

**Fact you need for the tests:** the test file makes its "repo" with
`mkdirSync(join(project, ".git"))`. That is not a real git repo, so a pin
there goes to `skilllib.json` (shared). A personal pin needs a real repo made
with `git init`.

### Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Type check | `pnpm type-check` | exit 0, no errors |
| One test file | `bun test --timeout 20000 src/install.test.ts` | `0 fail` |
| All tests | `pnpm test` | `0 fail` |

### Scope

**In scope**:
- `src/commands.ts` (only the `install` function)
- `src/json.ts` (only `InstallJson`)
- `src/install.test.ts`
- `skills/skilllib/SKILL.md` (one sentence on line 47)

**Out of scope**:
- `src/install.ts`: `installFound` and `InstalledSkill` stay as they are.
- New flags for `install` (`--personal`, `--shared`). Not in this part.
- `README.md`: plan 003 (part B) owns the docs.


### Steps

#### Step 1: Set the exit code in both modes

In `install` in `src/commands.ts`:

1. Inside the `if (!args.json) { for (const row of installed) { if (row.status === "exists" || row.status === "skipped") {`
   block, delete the line `process.exitCode = 1;`. Keep the `warn(...)`.
2. Directly before the line `if (args.json) json("install", results);` add:

```ts
  // In both modes: agents read the exit code. A skill that wasn't installed, or a link held back, isn't all that was asked.
  if (results.some((r) => r.status === "exists" || r.status === "skipped" || (r.project && incomplete(r.project)))) process.exitCode = 1;
```

**Verify**: `pnpm type-check` → exit 0.

#### Step 2: Put `dirs` and `personal` in the JSON row

1. In `src/json.ts`, change `project?: Change;` to:

```ts
  /** The change in this repo, as `add` prints it: with `dirs`, and `personal` when the pin is yours. */
  project?: ChangeJson;
```

2. In `src/commands.ts`, replace `if (args.json) json("install", results);` with:

```ts
  if (args.json) {
    const root = projectHere();
    json(
      "install",
      results.map((r): InstallJson[number] => (r.project && root ? { ...r, project: withDirs(root, [r.project])[0]! } : r)),
    );
  }
```

3. Add `InstallJson` to the existing `import type { … } from "./json.js"`
   line at the top of `src/commands.ts`.

**Verify**: `pnpm type-check` → exit 0.

#### Step 3: Print the right closing hint

Replace the final `else if (results.some(…)) info(dim("Commit skilllib.json and the skill folders."));`
with:

```ts
  else {
    const root = projectHere();
    const pins = root ? readManifest(root).skills : {};
    const added = results.filter((r) => r.project && r.project.action !== "skipped" && pins[r.name]);
    // Where the pin went decides what there is to commit, as `add` says it.
    if (added.some((r) => !pins[r.name]!.personal)) info(dim("Commit skilllib.json and the skill folders."));
    else if (added.length) info(dim(`Pinned for you (${tildify(personalPinsDir())}), kept out of git. To share it with the team: skilllib add <name> --shared, then commit skilllib.json and the skill folders.`));
  }
```

`readManifest`, `personalPinsDir` and `tildify` are already imported in
`src/commands.ts` (check lines 1-47; add to the existing import if one is
missing).

**Verify**: `pnpm type-check` → exit 0.

#### Step 4: Document the result shape for agents

In `skills/skilllib/SKILL.md` line 47, the paragraph ends with:
`` `install` and `search` accept `--json`. ``

Replace that last sentence with:

```
`install` and `search` accept `--json`. `install` prints `[{name, source, status, reason, project, global}]`: `status` is `added`, `updated`, `unchanged`, `exists` or `skipped`. `exists` and `skipped` exit 1 and have a `reason`. `project` is the change that `add` prints, with `dirs` and `personal`.
```

**Verify**: `grep -c "exists\` and \`skipped\` exit 1" skills/skilllib/SKILL.md` → `1`.

#### Step 5: Add the tests

In `src/install.test.ts` add `spawnSync` to the `node:child_process` import.
Add these tests inside `describe("install", …)`:

```ts
  test("install --json exits 1 when the library already has a different version of the skill", () => {
    const src = join(tmp, "src", "alpha");
    skill(src, "alpha");
    const run = () => spawnSync(process.execPath, [join(import.meta.dir, "index.ts"), "install", src, "--json"], { cwd: project, env: process.env, encoding: "utf-8" });
    expect(run().status).toBe(0);
    writeFileSync(join(src, "SKILL.md"), "---\nname: alpha\ndescription: d\n---\nanother body\n");
    const second = run();
    expect(second.status).toBe(1);
    expect(second.stdout.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(second.stdout)[0]).toMatchObject({ name: "alpha", status: "exists" });
  });

  test("in a real git repo the pin is personal: the row says so, and nothing says to commit skilllib.json", () => {
    const repo = join(tmp, "real");
    mkdirSync(repo);
    execFileSync("git", ["init", "-q", repo]);
    const src = join(tmp, "src", "alpha");
    skill(src, "alpha");
    const json = spawnSync(process.execPath, [join(import.meta.dir, "index.ts"), "install", src, "--json"], { cwd: repo, env: process.env, encoding: "utf-8" });
    expect(json.status).toBe(0);
    expect(existsSync(join(repo, "skilllib.json"))).toBe(false);
    expect(JSON.parse(json.stdout)[0].project).toMatchObject({ action: "installed", personal: true, dirs: [".claude/skills"] });
    const text = spawnSync(process.execPath, [join(import.meta.dir, "index.ts"), "install", src], { cwd: repo, env: process.env, encoding: "utf-8" });
    expect(text.stdout + text.stderr).not.toContain("Commit skilllib.json");
  });
```

**Verify**: `bun test --timeout 20000 src/install.test.ts` → `0 fail`.

#### Step 6: Full check

**Verify**: `pnpm type-check && pnpm test` → exit 0, `0 fail`.

### Test plan

- Test 1 is the regression test for the exit code.
- Test 2 covers the personal pin in the JSON row and the closing hint.
- Pattern: `installs a local skill into this project` in `src/install.test.ts:61-72`.

### Done criteria

- [ ] `pnpm type-check` exits 0
- [ ] `pnpm test` exits 0 with `0 fail`; the two new tests pass
- [ ] `grep -c 'results.some((r) => r.status === "exists"' src/commands.ts` → `1` (the exit code is set once, for both modes)
- [ ] `git status --short` lists only the four in-scope files (and `plans/`)

### STOP conditions

Stop and report if:

- The excerpts in "Current state" do not match the live code (other than the
  lines that part A added).
- In test 2, `skilllib.json` exists in the `git init` repo after the install.
  That means the assumption "a pin in a real git repo is personal by default"
  is false here. Report what you see.
- An existing test fails because it expected exit 0 from an `install` that was
  skipped. Report the test name. Do not change the test.

### Maintenance notes

- Any new result status for `install` must be added to the exit-code line in
  step 1.
- Plan 002 (part D) adds a contract test that covers this exit code for every command.
- Reviewer: check that the text-mode warnings for `exists`/`skipped` are still
  printed.

---

## Part C: A repo that is one skill is installed under the skill's name

### Why this matters

Many skills are published as a repo with `SKILL.md` at the root. A GitHub
archive extracts into one folder that GitHub names after the archive (the repo
name plus a ref or commit id), not after the skill. skilllib uses the folder
name as the skill's name. So `skilllib install owner/my-skill` puts the skill
in the library under the archive folder name. That wrong name then goes into
the pins, the agent folders and the `/name` command. After this part, a
root-level skill gets the `name` from its `SKILL.md`, or the repo name when
the file has no usable name.

### Current state

- `src/install.ts`: `downloadGitHub` (lines 110-157) returns the extracted
  root. `findSkillDirs` (lines 85-101) returns `[root]` when the root has a
  `SKILL.md`.
- `src/library.ts:1180-1181`: `importSkill` names the skill after the folder:

```ts
export function importSkill(dir: string, { force = false } = {}): { name: string; status: "added" | "updated" | "unchanged" | "exists" } {
  const name = basename(dir);
```

- `src/skills.ts:11-29`: `readSkillInfo(dir)` returns `{ name, description }`
  from the frontmatter. **When the frontmatter has no `name`, it returns the
  folder name** (`basename(dir)`). That detail matters in step 1.

The end of `downloadGitHub` at the planned commit, `src/install.ts:153-157`:

```ts
  rmSync(archive, { force: true });
  const top = readdirSync(dest);
  const root = top.length === 1 && statSync(join(dest, top[0]!)).isDirectory() ? join(dest, top[0]!) : dest;
  return { tmp: dest, root };
}
```

The name rule already in the file, `src/install.ts:38`:

```ts
const NAME = /^[A-Za-z0-9_.-]+$/;
```

Conventions to match: TypeScript strict, ESM, local imports end in `.js`, no
`any`. Comments are short and say why. Tests use `bun:test`; test names are
full sentences. The test file has a helper
`skill(dir, name = "alpha")` that writes a `SKILL.md` with that frontmatter
name (`src/install.test.ts:15-18`).

### Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Type check | `pnpm type-check` | exit 0, no errors |
| One test file | `bun test --timeout 20000 src/install.test.ts` | `0 fail` |
| All tests | `pnpm test` | `0 fail` |

### Scope

**In scope**:
- `src/install.ts`
- `src/install.test.ts`

**Out of scope**:
- `src/library.ts`. `importSkill` keeps using the folder name. This part
  renames the folder, so no API changes.
- Local installs (`skilllib install ./folder`). There the folder name is the
  user's choice.


### Steps

#### Step 1: Add `nameRootSkill` to `src/install.ts`

Add `renameSync` to the `node:fs` import on line 2. Add this exported function
directly before `downloadGitHub`:

```ts
/**
 * A downloaded repo that is one skill (SKILL.md at its root) sits in a folder GitHub names after the archive.
 * The skill's name is its folder's name, so the folder is renamed: to the name SKILL.md gives, or the repo's.
 * Returns the root to use from now on.
 */
export function nameRootSkill(dest: string, root: string, repo: string): string {
  if (root === dest || !isSkillDir(root)) return root;
  const given = readSkillInfo(root).name;
  // readSkillInfo falls back to the folder's name: that is the archive's name, the one to replace.
  const name = given !== basename(root) && NAME.test(given) && given !== "." && given !== ".." ? given : repo;
  const named = join(dest, name);
  if (named === root) return root;
  renameSync(root, named);
  return named;
}
```

`isSkillDir`, `readSkillInfo`, `basename` and `join` are already imported in
this file.

**Verify**: `pnpm type-check` → exit 0.

#### Step 2: Use it in `downloadGitHub`

Change the line that computes `root` so the result goes through the new
function. The two lines become:

```ts
  const top = readdirSync(dest);
  const root = nameRootSkill(dest, top.length === 1 && statSync(join(dest, top[0]!)).isDirectory() ? join(dest, top[0]!) : dest, repo);
```

Leave the `return` line as it is (it may already carry `dropped` from plan
001).

**Verify**: `pnpm type-check` → exit 0.

#### Step 3: Add the test

In `src/install.test.ts`, add `nameRootSkill` to the import from
`./install.js`. Add inside `describe("install", …)`:

```ts
  test("a downloaded repo that is one skill takes the name in its SKILL.md, or the repo's name when it has none", () => {
    const dl = join(tmp, "dl");
    skill(join(dl, "skills-abc123"), "frontend-design");
    const named = nameRootSkill(dl, join(dl, "skills-abc123"), "skills");
    expect(named).toBe(join(dl, "frontend-design"));
    expect(findSkillDirs(named).map((d) => basename(d))).toEqual(["frontend-design"]);

    const dl2 = join(tmp, "dl2");
    mkdirSync(join(dl2, "tool-abc123"), { recursive: true });
    writeFileSync(join(dl2, "tool-abc123", "SKILL.md"), "---\ndescription: d\n---\nbody\n");
    expect(nameRootSkill(dl2, join(dl2, "tool-abc123"), "tool")).toBe(join(dl2, "tool"));

    // A repo of several skills has no SKILL.md at its root: its folder keeps its name.
    const dl3 = join(tmp, "dl3");
    skill(join(dl3, "pack-abc123", "one"), "one");
    expect(nameRootSkill(dl3, join(dl3, "pack-abc123"), "pack")).toBe(join(dl3, "pack-abc123"));
  });
```

**Verify**: `bun test --timeout 20000 src/install.test.ts` → `0 fail`.

#### Step 4: Full check

**Verify**: `pnpm type-check && pnpm test` → exit 0, `0 fail`.

### Test plan

- One new test with three cases: name from frontmatter, fallback to the repo
  name, and a multi-skill repo left alone.
- The real download is not tested (no network in the suite).

### Done criteria

- [ ] `pnpm type-check` exits 0
- [ ] `pnpm test` exits 0 with `0 fail`; the new test passes
- [ ] `grep -n "nameRootSkill" src/install.ts` shows the definition and one call in `downloadGitHub`
- [ ] `git status --short` lists only `src/install.ts` and `src/install.test.ts` (and `plans/`)

### STOP conditions

Stop and report if:

- The excerpts in "Current state" do not match the live code (other than the
  lines that parts A and B added).
- `readSkillInfo` no longer falls back to the folder name when the
  frontmatter has no `name`.
- The new test fails twice after a reasonable fix attempt.

### Maintenance notes

- A user who already installed such a skill has it in the library under the
  old archive-style name. This part does not rename it. They can remove the
  old entry and install again.
- If `importSkill` ever gets a `name` option, this rename can go.
- Reviewer: confirm that the rename happens only inside the temp download
  folder (`dest`), never on a path the user gave.

---

## Part D: `install` and `search` time out, honor a branch in the URL, and clean up

### Why this matters

Agents call `skilllib search` and `skilllib install` and wait for them. Four
problems make that unreliable:

1. No network call has a timeout. A stalled connection blocks the agent.
2. A GitHub URL such as `…/tree/v2/skills/foo` names a branch or tag. skilllib
   drops it and silently installs from the default branch.
3. `github.com/owner/repo` without `https://` is parsed as owner
   `github.com`, which gives a confusing "not found" error.
4. If the downloaded repo cannot be read after extraction, the temp folder is
   never removed. Also, only the compressed size is limited: a small archive
   can extract to a very large tree that skilllib then hashes and copies.

### Current state

All code is in `src/install.ts`. Tests are in `src/install.test.ts`.

Search, lines 23-26:

```ts
export async function searchSkills(query: string): Promise<SkillHit[]> {
  const url = `${SEARCH_API}/api/search?${new URLSearchParams({ q: query, limit: "20" })}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`skills.sh search failed (${res.status})`);
```

Spec type and parsing, lines 36-75:

```ts
export type InstallSpec = { owner: string; repo: string; skill?: string } | { local: string };

const NAME = /^[A-Za-z0-9_.-]+$/;

export function parseInstallSpec(input: string): InstallSpec | null {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  if (trimmed.startsWith(".") || trimmed.startsWith("/") || trimmed.startsWith("~") || /^[A-Za-z]:[\\/]/.test(trimmed)) {
    return { local: trimmed.replace(/^~(?=$|[\\/])/, userHome()) };
  }
  let text = trimmed;
  try {
    const url = new URL(trimmed);
    const host = url.hostname.replace(/^www\./, "");
    const parts = url.pathname.split("/").filter(Boolean);
    if (host === "skills.sh" && parts.length >= 2) text = parts.length >= 3 ? `${parts[0]}/${parts[1]}@${parts.slice(2).join("/")}` : `${parts[0]}/${parts[1]}`;
    else if (host === "github.com" && parts.length >= 2) {
      const repo = parts[1]!.replace(/\.git$/, "");
      if (parts[2] === "tree" && parts.length >= 5) return namePair(parts[0]!, repo, parts.slice(4).join("/"));
      return namePair(parts[0]!, repo);
    } else return null;
  } catch {
    // not a URL
  }
  …
}

function namePair(owner: string, repo: string, skill?: string): InstallSpec | null {
  if (!NAME.test(owner) || !NAME.test(repo) || owner === "." || repo === "." || owner === ".." || repo === "..") return null;
  return skill ? { owner, repo, skill } : { owner, repo };
}
```

Skill selection, lines 103-107:

```ts
function skillNamed(dirs: string[], skill: string | undefined): string[] {
  if (!skill) return dirs;
  const want = skill.split("/").filter(Boolean).pop()!;
  return dirs.filter((d) => basename(d) === want || readSkillInfo(d).name === want);
}
```

Download, lines 110-152 (shortened):

```ts
export async function downloadGitHub(owner: string, repo: string): Promise<{ tmp: string; root: string }> {
  const dest = mkdtempSync(join(tmpdir(), "skilllib-"));
  const archive = join(dest, "repo.tar.gz");
  const url = `https://codeload.github.com/${owner}/${repo}/tar.gz/HEAD`;
  let res: Response;
  try {
    res = await fetch(url, { redirect: "follow" });
  } catch (err) {
    rmSync(dest, { recursive: true, force: true });
    throw new Error(`couldn't download ${owner}/${repo} (${err instanceof Error ? err.message : err})`);
  }
  if (!res.ok || !res.body) {
    rmSync(dest, { recursive: true, force: true });
    throw new Error(res.status === 404 ? `${owner}/${repo} not found on GitHub` : `couldn't download ${owner}/${repo} (${res.status})`);
  }
  …
  try {
    await pipeline(/* body → archive, counting bytes against MAX_BYTES */);
    execFileSync("tar", ["-xzf", archive, "-C", dest], { stdio: "ignore" });
  } catch (err) {
    rmSync(dest, { recursive: true, force: true });
    if (err instanceof Error && /larger than|couldn't download/.test(err.message)) throw err;
    throw new Error(`couldn't extract ${owner}/${repo}`);
  }
```

Resolve, lines 249-252:

```ts
  const got = await downloadGitHub(spec.owner, spec.repo);
  const source = spec.skill ? `${spec.owner}/${spec.repo}@${spec.skill}` : `${spec.owner}/${spec.repo}`;
  const dirs = skillNamed(findSkillDirs(got.root), spec.skill);
  return { tmp: got.tmp, dirs, source, many: !spec.skill && dirs.length > 1 };
```

The caller in `src/commands.ts` removes `resolved.tmp` in a `finally`, but
only when `resolveInstallDir` returned. If `findSkillDirs` or `skillNamed`
throws, nothing removes the temp folder.

An existing test expects the branch to be dropped,
`src/install.test.ts:43-47`. Step 2 changes that expectation:

```ts
    expect(parseInstallSpec("https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines")).toEqual({
      owner: "vercel-labs",
      repo: "agent-skills",
      skill: "skills/web-design-guidelines",
    });
```

Conventions to match: TypeScript strict, ESM, local imports end in `.js`, no
`any`. Comments are short and say why. Tests use `bun:test`; names are full
sentences. `InstallSpec` is internal (not in `src/json.ts`), so a new optional
field is safe.

### Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Type check | `pnpm type-check` | exit 0, no errors |
| One test file | `bun test --timeout 20000 src/install.test.ts` | `0 fail` |
| All tests | `pnpm test` | `0 fail` |
| Check the archive URL form (needs network) | `curl -sL -o /dev/null -w '%{http_code}\n' https://codeload.github.com/anthropics/skills/tar.gz/main` | `200` |

### Scope

**In scope**:
- `src/install.ts`
- `src/install.test.ts`

**Out of scope**:
- `src/commands.ts`. The `install` command needs no change.
- A branch name that contains `/` (for example `feature/x`). A `tree/` URL
  cannot say where such a name ends. It stays unsupported; do not guess.
- Retry logic, progress output, proxies.


### Steps

#### Step 1: Timeouts

Add near the other constants (after `MAX_BYTES`):

```ts
// Agents wait on these commands: a connection that stalls must end, not hang.
const SEARCH_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;
const TAR_TIMEOUT_MS = 60_000;
const timedOut = (err: unknown) => err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
```

1. In `searchSkills`, replace `const res = await fetch(url);` with:

```ts
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) });
  } catch (err) {
    throw new Error(timedOut(err) ? `skills.sh search timed out after ${SEARCH_TIMEOUT_MS / 1000}s` : `skills.sh search failed (${err instanceof Error ? err.message : err})`);
  }
```

2. In `downloadGitHub`, change the fetch to
   `fetch(url, { redirect: "follow", signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })`.
   The signal also ends a stalled body read.
3. Change the `tar` call to
   `execFileSync("tar", ["-xzf", archive, "-C", dest], { stdio: "ignore", timeout: TAR_TIMEOUT_MS });`
4. In the `catch` after the pipeline, add this line before the existing
   `if (err instanceof Error && /larger than|couldn't download/…` line:

```ts
    if (timedOut(err)) throw new Error(`couldn't download ${owner}/${repo} (timed out after ${DOWNLOAD_TIMEOUT_MS / 1000}s)`);
```

**Verify**: `pnpm type-check` → exit 0.

#### Step 2: Keep the branch or tag of a `tree/` URL

1. Change the type:
   `export type InstallSpec = { owner: string; repo: string; skill?: string; ref?: string } | { local: string };`
2. Change `namePair` to accept and check a ref:

```ts
function namePair(owner: string, repo: string, skill?: string, ref?: string): InstallSpec | null {
  if (!NAME.test(owner) || !NAME.test(repo) || owner === "." || repo === "." || owner === ".." || repo === "..") return null;
  // A branch or tag from a tree/ URL: one path part. (One with a "/" can't be told from the folder after it.)
  if (ref !== undefined && (!NAME.test(ref) || ref === "." || ref === "..")) return null;
  return { owner, repo, ...(skill ? { skill } : {}), ...(ref ? { ref } : {}) };
}
```

3. In `parseInstallSpec`, replace the `tree` line with:

```ts
      if (parts[2] === "tree" && parts.length >= 4) return namePair(parts[0]!, repo, parts.slice(4).join("/") || undefined, parts[3]!);
```

4. Change the signature and URL of `downloadGitHub`:

```ts
export async function downloadGitHub(owner: string, repo: string, ref = "HEAD"): Promise<…same return type as now…> {
  …
  const url = `https://codeload.github.com/${owner}/${repo}/tar.gz/${encodeURIComponent(ref)}`;
```

   In the 404 message, name the ref when it is not `HEAD`:
   `` res.status === 404 ? `${owner}/${repo}${ref === "HEAD" ? "" : ` (${ref})`} not found on GitHub` : … ``

5. In `resolveInstallDir`, pass it: `await downloadGitHub(spec.owner, spec.repo, spec.ref)`.

6. In `src/install.test.ts`, update the existing expectation at lines 43-47:
   add `ref: "main",` to the expected object.

**Verify**: `pnpm type-check` → exit 0. Then, if you have network:
`curl -sL -o /dev/null -w '%{http_code}\n' https://codeload.github.com/anthropics/skills/tar.gz/main` → `200`.

#### Step 3: Accept `github.com/owner/repo` without a scheme

In `parseInstallSpec`, directly after `let text = trimmed;` add:

```ts
  // Pasted without the scheme: still that site's URL, not an owner named "github.com".
  const asUrl = /^(www\.)?(github\.com|skills\.sh)\//.test(trimmed) ? `https://${trimmed}` : trimmed;
```

and change `const url = new URL(trimmed);` to `const url = new URL(asUrl);`.

**Verify**: `pnpm type-check` → exit 0.

#### Step 4: Match a skill by its path when the path is given

Replace `skillNamed` with this exported version. Add `relative` to the
`node:path` import.

```ts
/** The skill folders a name picks. A path (`skills/foo`) picks that folder; a bare name picks by folder or SKILL.md name. */
export function skillNamed(root: string, dirs: string[], skill: string | undefined): string[] {
  if (!skill) return dirs;
  const parts = skill.split("/").filter(Boolean);
  if (parts.length > 1) {
    const exact = dirs.filter((d) => relative(root, d).split(sep).join("/") === parts.join("/"));
    if (exact.length) return exact;
  }
  const want = parts.pop()!;
  return dirs.filter((d) => basename(d) === want || readSkillInfo(d).name === want);
}
```

Update the one caller in `resolveInstallDir`:
`skillNamed(got.root, findSkillDirs(got.root), spec.skill)`.

**Verify**: `pnpm type-check` → exit 0.

#### Step 5: Remove the temp folder when the repo cannot be read

In `resolveInstallDir`, wrap the work after the download:

```ts
  const got = await downloadGitHub(spec.owner, spec.repo, spec.ref);
  const source = spec.skill ? `${spec.owner}/${spec.repo}@${spec.skill}` : `${spec.owner}/${spec.repo}`;
  let dirs: string[];
  try {
    dirs = skillNamed(got.root, findSkillDirs(got.root), spec.skill);
  } catch (err) {
    // The caller only gets `tmp` to remove when this returns.
    rmSync(got.tmp, { recursive: true, force: true });
    throw err;
  }
```

Keep the existing `return` (with `dropped`, which part A added).

**Verify**: `pnpm type-check` → exit 0.

#### Step 6: Limit the extracted size

Add after `MAX_BYTES`:

```ts
// What the archive unpacks to: a small download can hold a very large tree, which would then be hashed and copied.
const MAX_EXTRACTED_BYTES = 256 * 1024 * 1024;

function extractedBytes(dir: string): number {
  let total = 0;
  for (const name of readdirSync(dir)) {
    const st = lstatSync(join(dir, name));
    total += st.isDirectory() ? extractedBytes(join(dir, name)) : st.size;
    if (total > MAX_EXTRACTED_BYTES) return total;
  }
  return total;
}
```

In `downloadGitHub`, inside the `try`, directly after the `tar` call, add:

```ts
    if (extractedBytes(dest) > MAX_EXTRACTED_BYTES) throw new Error(`${owner}/${repo} is larger than ${MAX_EXTRACTED_BYTES / 1024 / 1024}MB once unpacked`);
```

The existing `catch` already removes `dest` and re-throws messages that match
`/larger than/`.

**Verify**: `pnpm type-check` → exit 0.

#### Step 7: Tests

In `src/install.test.ts`, add `skillNamed` to the import from `./install.js`.

1. Add to the `parseInstallSpec` test:

```ts
    expect(parseInstallSpec("github.com/anthropics/skills")).toEqual({ owner: "anthropics", repo: "skills" });
    expect(parseInstallSpec("https://github.com/anthropics/skills/tree/v2")).toEqual({ owner: "anthropics", repo: "skills", ref: "v2" });
```

2. Add inside `describe("install", …)`:

```ts
  test("a path picks that one skill folder; a bare name picks every folder with that name", () => {
    const root = join(tmp, "pack");
    skill(join(root, "a", "foo"), "foo");
    skill(join(root, "b", "foo"), "foo");
    const dirs = findSkillDirs(root);
    expect(skillNamed(root, dirs, "b/foo")).toEqual([join(root, "b", "foo")]);
    expect(skillNamed(root, dirs, "foo").sort()).toEqual([join(root, "a", "foo"), join(root, "b", "foo")]);
  });
```

**Verify**: `bun test --timeout 20000 src/install.test.ts` → `0 fail`.

#### Step 8: Full check

**Verify**: `pnpm type-check && pnpm test` → exit 0, `0 fail`.

### Test plan

- Parsing: the scheme-less URL, a `tree/<ref>` URL with and without a path.
- Skill selection by path.
- Not tested: timeouts, the size limit and the temp cleanup. They need a
  network or a fake server, and the suite has neither. Say so in your report.

### Done criteria

- [ ] `pnpm type-check` exits 0
- [ ] `pnpm test` exits 0 with `0 fail`
- [ ] `grep -c "AbortSignal.timeout" src/install.ts` → `2`
- [ ] `grep -n "tar.gz/HEAD" src/install.ts` → no output
- [ ] `git status --short` lists only `src/install.ts` and `src/install.test.ts` (and `plans/`)

### STOP conditions

Stop and report if:

- The excerpts in "Current state" do not match the live code (other than the
  lines that parts A to C added).
- The `curl` check in step 2 returns something other than `200`. Then the
  `tar.gz/<ref>` URL form is wrong: do not ship step 2.
- A test outside `src/install.test.ts` fails.

### Maintenance notes

- The size limit runs after `tar` has written the files. It bounds what
  skilllib hashes and copies; it does not stop the disk write itself.
- A branch name with `/` in a `tree/` URL is still unsupported. A possible
  later form is `owner/repo#ref`.
- Reviewer: check that the timeout error for a download is not reported as
  "couldn't extract".
