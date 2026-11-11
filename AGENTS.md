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
