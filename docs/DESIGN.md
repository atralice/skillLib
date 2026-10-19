# skilllib TUI: design

How the app looks and behaves, and why. It's written for people and for agents changing the TUI.

- **The code is the source of truth.** This doc explains it; if they disagree, the code wins and this doc gets fixed.
- **Every screen here is rendered from the app**, on the sample data in `src/tui/sample.ts`, by `pnpm design` (`src/tui/design.ts`). Each is in `docs/design/` twice: `<name>.svg` to look at, `<name>.txt` to read (the same characters without color; selection and highlights only show in the SVG).
- Change the UI → run `pnpm design` → update this doc in the same PR. See [Changing the design](#changing-the-design).

![A repo's skills, with the Places pane on the left and the selected skill's details below](design/repo.svg)

---

## Principles

These came out of many rounds of using it. Each one has been broken before and felt wrong; keep them.

1. **One path through the app: Places → list → details.** `enter` or `→` goes one pane deeper, `esc` or `←` one pane back, always. No key jumps sideways to a different place.
2. **Typing filters the pane you're in.** Letters, digits, `-`, `_` and `.` are never commands (skill names use them). Commands live on `space`, `enter`, arrows, `tab`, `?` and `ctrl`.
3. **Show each fact once.** If the list says it, the details don't repeat it; if the sidebar shows a count, the list title doesn't. When something appears twice, remove one.
4. **Details are about where you're looking from.** Seen from a repo, a skill shows that repo's issues, uses and actions. Machine-wide matters (global copies, plugins) are Global's business; a repo only says "Loads in every repo" and offers *Open in Global*.
5. **Every row has something to do.** A details pane is never empty of actions. Rows that start something (`+ Add a skill…`) are rows too, pinned on top.
6. **Fix it where you see it.** An issue carries its fixes. `★` marks the recommended one and `space` applies it. Issues that are a matter of taste are marked *your call*: `space` shows the choices instead, and "fix all" never touches them.
7. **Say what happens before it happens.** Every change shows a preview (what moves where, which repos) in the confirm box or the repo picker.
8. **Nothing is lost.** Anything skilllib removes goes to Settings › Backups, and `enter` there puts it back.
9. **Quiet by default.** One line at the bottom: a few hints for where you are, replaced by the result of what you just did until the next key.

---

## Layout

Two layouts, picked by terminal width (`SIDEBAR_AT = 80` columns in `App.tsx`).

### 80 columns or more: three panes

```
╭ Places ──╮╭ List ─────────────────────╮
│          ││ tabs · column titles      │
│          ││ rows                      │
│          │╰───────────────────────────╯
│          │╭ Details ──────────────────╮
│          ││ the selected row          │
╰──────────╯╰───────────────────────────╯
 hints, or the last message
```

- **Places** is 28 columns wide (`SIDEBAR_W`): your skills, Global, Plugins, Health, every repo, then Settings and Help.
- **List and details share the rest.** With 30 rows or more (`split`), details sit under the list and half the height goes to each. Shorter terminals show the list only, and `enter` swaps in the details.
- **Focus** is the pane with the bright border (`accent`); the others are dim (`accentDim`). Only the focused pane shows a selection background.
- While Places is focused on a repo, the details pane shows the repo's overview (folder, `skilllib.json` state, the plugins that load there).

| | |
|---|---|
| ![Start](design/start.svg) | ![Details focused](design/repo-details.svg) |
| Start: Places focused on the repo you're in | Details focused: `↑↓` between fixes, `←→` along actions |

### Under 80 columns: a top bar

Places become a one-line bar at the top; `←` `→` switch places, wherever the list's cursor is (on a group too: `space` opens and closes it, `enter` opens it). A repo's overview sits in a small panel above its list, since there's no Places pane to show it.

| | |
|---|---|
| ![Narrow](design/narrow.svg) | ![Narrow details](design/narrow-details.svg) |
| A repo, 78×24 | Short terminal: `enter` swaps the list for the details |

---

## Keys

| Key | Does |
|---|---|
| *type* | Filter the pane you're in. Word initials match too: `cfw` finds `cloudflare-workers` (`W.matches`). In Places it filters repos. |
| `↑` `↓` | Move. In details, from line to line (a fix per line, or a row of actions). |
| `enter` `→` | One pane deeper. On a list row: focus its details. In details: apply the selected option. On a closed group: open it. |
| `esc` `←` | One pane back. `esc` clears a filter first. `←` in details moves left along a row of actions, and goes back from its first one. On an open group or one of its skills, `←` closes the group (with the Places pane; under 80 columns `←` `→` switch places). |
| `space` | Apply the `★` fix of the row's worst issue; for *your call*, jump to its choices in the details. On a group: open or close it. |
| `tab` `⇧tab` | Next / previous tab |
| `?` | Keys and symbols |
| `ctrl+r` | Read everything again from disk |
| `ctrl+c` | Quit |

The hints at the bottom change with focus and modal (`hints` in `App.tsx`); keep them to what works right now.

---

## Places

### A repo (Projects)

The dashboard for one repo: everything agents can use in it, one row per skill.

![A repo](design/repo.svg)

- **Action rows:** `+ Add a skill…`, `✦ Fix N issues automatically…` (only when there are some), `⋯ <repo>…` (open its folder, hide it, a review prompt for its skills).
- **Columns:** severity · Skill · Source · Uses (Claude Code, 30 days, this repo) · the worst issue in a few words.
- **Source tags:** `lib v2` (from your library, `accent`) · `repo` (committed by the team) and `untracked` (only on this machine), both `blue` · `global` / `global ✓` (kept on purpose), `yellow` · `⧉ vercel` (a plugin, `magenta`) · `◆ skilllib` (skilllib's own skill, `accent`) · `claude.ai`, `cursor` (`muted`).
- **One row per skill**, even when it loads from several places. The row shows the repo's copy first, then yours, then vendors' (`COPY_RANK`); the details list every copy under *Loaded from*. A link to nothing with no copy in the repo (doctor's `broken:<root>:…`) gets a row too, with just its issue and fix.
- **Tabs:** All · Issues · Local · Global · Plugins · Vendor, each with its count. The Issues count is yellow when it isn't zero.
- **Order:** worst issue first, then most used, then name. The order is fixed when a view opens and doesn't change after a fix, so rows stay under the cursor; the cursor stays on its row when one above it goes (the `✦ Fix` row after the last fix). It's re-sorted once when usage arrives (usage loads after the first paint because reading transcripts is slow).

| | |
|---|---|
| ![Filtered](design/repo-filtered.svg) | ![Issues tab](design/repo-issues-tab.svg) |
| Typing `re` filters; action rows hide while filtering | `tab` → Issues |
| ![Repo menu](design/repo-menu.svg) | |
| `⋯ web-app…` | |

A skill's details, top to bottom:

1. Description (up to 3 lines)
2. Issues, worst first, each followed by its fixes (`★` on the recommended one; *· your call* after the title of a decision). Or `✓ No issues`.
3. `Actions` — everything else, side by side and wrapping. Anything an issue above already offers isn't repeated.
4. `Usage here` — last used, a 30-day bar chart. In Global and Your skills it's `Usage`, with a bar per repo.
5. `Loaded from` — each copy's path and git state, and any other real copy in the repo (*another copy*: *Remove from repo* removes the first and says the other stays) (`✓ committed`, `± uncommitted changes`, `+ not committed`, `∅ gitignored`).

### Your skills

Your library: versioned master copies that repos install from.

![Your skills](design/your-skills.svg)

- **Action row:** `+ New skill…`.
- **Columns:** Skill · Ver · Used in (repos, and how many are behind, in yellow) · Uses (everywhere) · the issue or the description.
- **Only issue:** *In no repo, unused 30 days* (doctor's `unused:library`: in no repo, not loaded globally, and unused for 30 days; your call): delete them. *Add to repos…* is an action.
- **Actions:** Add to repos… · Remove from repos… · Delete from your library (from every repo too; the confirm names them) · Edit SKILL.md · Review prompt.

### Global

Everything that loads in every repo: your global folders, plugins, claude.ai skills, Cursor built-ins. Titled *Loads everywhere*.

![Global](design/global.svg)

- **Action rows:** `✦ Fix N issues automatically…`, `⧉ Review prompt for your N global skills…`.
- **Tabs:** as a repo's, without Local.
- **Issues:** doctor's, on the skills they name: broken links, loaded twice (yours and a claude.ai or system copy), plugins that repeat yours, extra or differing copies, skills not every agent you use can load, repo copies of a skill that also loads globally, and *Not reviewed* for each of your global skills you haven't decided about. *Not reviewed* has no fix: the row's actions move the skill to repos, keep it global on purpose, or delete it.
- **Vendor skills** can't be changed from here. Their actions say where to turn them off; a plugin's skills and groups offer *Open vercel in Plugins*, where plugins are managed.
- **The skilllib skill** (`◆ skilllib`, in the Global tab): out of date, its row offers the update (doctor's `agent-skill`); its action removes it (`skilllib agent-skill remove`).

| | |
|---|---|
| ![Group open](design/global-group-open.svg) | ![Plugin](design/global-plugin.svg) |
| A group, opened with `→` | A plugin's group: *Open vercel in Plugins* |

### Plugins

Every plugin installed, on or off, one row per install (a plugin can be installed for you and again in a project). Global shows a plugin's skills; this is where the plugin itself is turned on or off, updated, uninstalled or replaced.

![Plugins](design/plugins.svg)

- **Columns:** severity · Plugin (its name; the details title is `name@marketplace`) · agent (`✻` Claude Code, `⬡` Cursor) · Scope (`user`, `project <repo>`, `local <repo>` in `blue`, `claude.ai`) · Brings (`N skills +k`, k = other kinds: commands, agents, hooks, MCP servers) · On (`on` `green`, `off` `faint`, `?` for Cursor) · Uses (Claude Code, 30 days, its skills as `plugin:skill`) · the worst issue. Under 76 columns, Brings and Uses go (the details have both).
- **Tabs:** All · Issues.
- **Issues:** doctor's, all *your call* (removing, turning off or updating a plugin changes code that runs in your sessions, so "fix all" never does): *Repeats N of yours* (`✕` when an agent loads both, else `⚠`: remove it, turn it off, or turn it off in one repo only; a Cursor plugin's is reported only), *Update available* (update it), *Unused 30 days* (on, ships skills, none used: turn it off or uninstall it). An install's update or unused issue is only on that install's row.
- **Actions:** Turn it on / off · Update to vN · Replace *plugin* with library skills… · Uninstall · Open its folder · Review prompt. A synced plugin can't be uninstalled; a Cursor plugin only says to turn it off in Cursor.
- **Details:** description, issues, actions, then *Skills* (with their uses), *Also brings*, *Installed* (scope, repo, version, marketplace) and *Folder*.
- **The sidebar count** is the number of plugins, colored by the worst plugin issue.

![Plugin details](design/plugin-details.svg)

### Health

What `skilllib doctor` reports, one row per issue, worst first: the list shows its title; the details say what doctor says, then its fix (`★`) or choices. The same issues sit on the rows they name in a repo, Global, Plugins and Your skills. When your agents don't have the skilllib skill, its issue is here. The sidebar count is the number of issues, colored by the worst.

![Health](design/health.svg)

### Settings

Agents (`[x]` toggles which ones skilllib makes skills visible to) and the skilllib skill for them (`enter` installs it), project folders, hidden repos, and backups (`↺ name`, `enter` restores).

![Settings](design/settings.svg)

### Help

`?` anywhere. Any key closes it. Lines wrap to the pane; what doesn't fit is cut.

![Help](design/help.svg)

---

## Groups

Related skills fold into one row (`▸`), in a repo, Global and Your skills. Filtering shows every skill unfolded.

A skill's candidate groups, strongest first (`W.groupCandidates`):

1. **Where it came from**: a plugin (`⧉ vercel plugin`), claude.ai, Cursor built-ins, or its origin (an `npx skills` repo, a group you moved together, a plugin you replaced).
2. **When it arrived**: global folders created in the same minute (`frontend + 2 more · installed together 2026-09-20`). Not used for your library, where imports make every folder's time the same.
3. **Its first word**, 3 letters or more (`cloudflare-*`).

`W.assignGroups` gives each skill its strongest candidate that another skill shares, and drops groups of one.

A group row shows its worst severity, its label and size, and how many members have issues. Its details list the members and actions for all of them at once: *Move all N to repos…*, *Keep all N global on purpose*, *Delete all N*, *Add all N to repos…*, *Remove all N from this repo*, *Open plugin in Plugins*, *Review prompt*.

---

## Issues

The app shows the issues `skilllib doctor` reports, from `src/health.ts`: `findIssues`, plus `usageIssues` once Claude Code's transcripts are read (`ops.usageIssues`). Each health `Issue` names the rows it belongs on (`at`: a skill in a repo, or in Global; `plugin`: a plugin's row), and `world.ts` places it (`issuesAt`, `repoIssues`, `pluginIssues`, `libraryIssues`) and maps it for the screens (`issueOf`, once per issue): doctor's `fix` is the `★` one; `choices` make it *your call*; neither, and it's reported only. The list shows a `short` label by kind (`shortOf`); the details show its title. Some issues cover several skills (a repo's out-of-date ones, say): they sit on each skill's row, and their fix acts on all of them. **Fix all** runs each fix once.

| doctor id | Rows | Short | Severity | Your call | Fix or choices |
|---|---|---|---|---|---|
| `broken:<path>` | Global | Broken link | ✕ | | Remove the link |
| `broken:<root>:<dir>/<skill>` | Repo (its own row) | Broken link (no copy of it in the repo; next to a copy it's `tidy:`) | ✕ | when git tracks the link | Remove the link |
| `pin:<root>:<skill>` | Repo | Pinned version not in your library (folder missing) | ✕ | yes | Install your newest |
| `dup:<skill>` | Global | Loaded twice (yours and a claude.ai or system copy, in one agent) | ✕ | yes | none: turn that copy off at its source |
| `plugin:<id>` | Global (yours and the plugin's), each repo where both load, Plugins | Also in ⧉ *plugin* (Plugins: Repeats N of yours) | ✕ when an agent loads both, else ⚠ | yes | Remove the plugin · Turn the plugin off · Turn it off in *repo* only · Remove your *skills* from *repo* (only copies skilllib installed) |
| `plugin:<root>:<id>` | The repo, Plugins | The same, for a plugin a repo's settings turn on | ✕ | yes | Turn it off in *repo* only · Remove your *skills* from *repo* |
| `cursor-plugin:<name>` | Global and repos with the skill, Plugins | Also in Cursor's *name* | ⚠ | yes | none: turn it off in Cursor |
| `tidy:global` | Global | Extra copies | ⚠ | | Keep one copy of each |
| `conflict:global:<skill>` | Global | Copies differ (which agent runs which) | ✕ | yes | Keep the … copy (one per copy) |
| `review:global` | Global, each skill | Not reviewed | ⚠ | yes | none: the row's actions |
| `usable:global` / `usable:global:kept` | Global | Not every agent can use it | ⚠ | yes / no (kept global) | Link it for *agents* |
| `twice:<skill>` | Each repo with a copy, and Global | Repo and global copies | ⚠ | yes | Stop loading it globally (kept global: Remove the copies in *repos*, only ones skilllib installed) |
| `sync:<root>` | Repo | Folder missing | ✕ | | Sync the project |
| `unavailable:<root>:<skill>` | Repo | Pinned, not in your library (folder missing, no copy to restore: import it, or set SKILLLIB_HOME) | ✕ | yes | Remove it from skilllib.json |
| `update:<root>` | Repo | Out of date | ⚠ | yes | Update to the newest versions (every out-of-date skill in the repo; a skill's own *Update to vN* action updates just that one) |
| `tidy:<root>` | Repo | Extra copies (identical copies, or links no agent needs) | ⚠ | yes when git would see a change | Tidy · or Tidy, but keep git as it is / Tidy everything |
| `conflict:<root>:<skill>` | Repo | Copies differ | ✕ | yes | Keep the … copy (one per copy that can win) |
| `usable:<root>` | Repo | Not every agent can use it | ⚠ | yes when git tracks a folder a link goes in | Add the links · or Add links, but not where git tracks the folder / Add links everywhere |
| `uncommitted:<root>:<skill>` | Repo | Commit it first (only links into folders git tracks would help, and the copy isn't committed) | ⚠ | yes | none |
| `local:<root>:<skill>` | Repo | Not in your library | ⚠ | yes | Import into the library (committed: Copy into the library, the repo's copy stays) |
| `adopt:<root>:<skill>` | Repo | Not tracked | ⚠ | yes | Track it |
| `differs:<root>:<skill>` | Repo | Differs from your library (no library version matches) | ⚠ | yes | Update your library from it (then tracked) · Replace it with your library's. The team's copy (committed, or the repo's own folder): only Update your library from it |
| `npx:<root>:<skill>` | Repo | From npx skills | ⚠ | yes | Import it into your library (then tracked; committed, only copied) |
| `not-in-lib:<root>:<skill>` | Repo | No longer in your library | ⚠ | yes | Copy it back into your library |
| `edited:<root>:<skill>` | Repo | Edited here | ⚠ | yes | Save as a new version in Your skills · Discard the edits |
| `unused:<root>` | Repo | Unused 30 days (Claude Code) | ⚠ | yes | Remove the skills skilllib installed from *repo* |
| `unused:library` | Your skills | In no repo, unused 30 days | ⚠ | yes | Delete them from Your skills |
| `plugin-update:[<project>:]<id>` | Plugins (that install) | Update available | ⚠ | yes | Update to vN (`claude plugin update`) |
| `plugin-unused:[<project>:]<id>` | Plugins (that install) | Unused 30 days (on, ships skills, none used; Claude Code) | ⚠ | yes | Turn the plugin off · Uninstall the plugin (not synced or settings-only ones) |
| `agent-skill` | Global's `skilllib` row, Health | Its title | ⚠ | yes when missing | Install / Update the skilllib skill |

While a skill's copies differ, the library ones (*Not in your library*, *Not tracked*, *Differs from your library*) are left out: the copy they'd compare is arbitrary. Choices that change what git tracks say so in their hint, shown in the confirm before you apply them.

Severity: `✕` problem (`red`), `⚠` suggestion (`yellow`), as doctor has them. A row shows only its worst; a repo in Places shows the worst of its rows.

---

## Modals

All replace the content area (Places stays visible), except confirm, which opens under the list. `esc` cancels (Help closes on any key; the first-run agents question can't be skipped).

| | |
|---|---|
| ![Confirm](design/confirm.svg) | ![Repo picker](design/repo-picker.svg) |
| **Confirm**: the fix as its title, the preview as its body, as tall as the preview needs. `enter` or `y` applies. | **Repo picker**: the preview, then repos to tick with `space`. Pre-ticked: repos where the skill was used. Typing filters. Refuses an empty pick unless the fix allows it. |
| ![Add a skill](design/add-skill.svg) | ![Fix all](design/fix-all.svg) |
| **Add a skill**: one box. Typing searches your library; the last rows create a skill with that name (it opens in `$EDITOR`) or copy a prompt for an agent to write it. | **Fix automatically**: every issue with a `★` fix, once each, as doctor's title → the fix, all ticked; untick with `space`. |
| ![Add a group](design/add-group.svg) | |
| **Adding several**: `space` ticks library skills and `enter` adds them all (picks survive searching). Related skills (a plugin's, an `npx skills` repo's, or ones named alike, as in Your skills) sit under a group row: `space` on it ticks every member, `enter` on it adds them. A group spans your whole library, so typing narrows it but never regroups it; one member left is just a skill. | |

Also: **menu** (a list of options, e.g. `⋯ repo…`), **input** (one line, e.g. a project folder), and **agents** (the first run: which agents you use, then where your projects are).

After a change, the app reads everything from disk again (`reload`) and shows the result on the bottom line: `✓` (`green`) when it worked, `✗` (`red`) when it failed (`failed` results, and errors), `!` (`yellow`) when it waits on a follow-up question (`then`). A result can carry such a question, such as allowing links in a git-tracked folder, which opens as another confirm. `esc` on it keeps the result on the bottom line, so you still see what the change left undone (e.g. which agents can't see a skill). **Fix all** doesn't ask follow-ups: it runs only doctor's fixes (never a decision), and its result counts what it applied and names each one that failed.

Changing what every repo loads (stopping a global skill, removing a plugin or turning it off) is always a decision, never in **Fix all**.

---

## Visual language

### Colors (`src/tui/theme.ts`)

| Token | Hex | Used for |
|---|---|---|
| `accent` | `#8B9DFF` | Focused border and title, section headers, action rows, group rows, `lib vN`, the selected tab's background |
| `accentDim` | `#4B5578` | Unfocused borders, separators, secondary bars in usage charts |
| `text` | `#E5E7EB` | The selected row, values, titles in details |
| `muted` | `#8A93A6` | Descriptions, labels, counts, unselected tabs |
| `faint` | `#5A6275` | Column titles, hints, *your call*, empty values |
| `green` | `#6BCB77` | `✓`, `★`, `[x]`, `[-]` (some of a group ticked), success messages, Health with nothing to fix |
| `yellow` | `#F2C94C` | Suggestions, `global`, repos behind, the Issues tab count |
| `red` | `#EF6B6B` | Problems, `✗` failed actions |
| `magenta` | `#C792EA` | Plugins (`⧉ name`) |
| `blue` | `#5EB8F7` | `repo` and `untracked` |
| `selection` | `#2A3350` | The selected row's and option's background (focused pane only) |

Text on an `accent` background (the selected tab, the top bar's place) is `#0B1020`.

### Symbols

| | Means |
|---|---|
| `▌` | The cursor row |
| `▸` / `▾` | A closed / open group; in details, the selected fix |
| `✕` `⚠` | Problem, suggestion |
| `★` | Recommended fix |
| `✓` | No issues; `global ✓` = kept global on purpose; `✓ committed` |
| `◆` | The repo you're in (and the app's mark) |
| `▤` `◈` `⧉` `✓` `⚙` `?` | Your skills, Global, Plugins, Health, Settings, Help |
| `⧉` | A plugin; also *copy a prompt* |
| `✦` | Automatic: fix all, or an agent writes it |
| `+` `⋯` `↺` | Add or create · more for this repo · restore a backup |
| `±` `+` `∅` | Git: uncommitted changes · not committed · gitignored |
| `⌕ text▏` | The current filter |
| `✻` `⬡` `◎` `ℤ` `✶` | Claude Code, Cursor, Codex, Zed, Grok |
| `…` | Truncated, or opens something more (`Add to repos…`) |

### Text

- Labels are plain actions: *Remove from repo*, *Keep it global on purpose*. A label ending in `…` asks something before acting.
- Previews say exactly what moves where: `Move ~/.claude/skills/x to Settings › Backups`.
- No jargon on screen: "Loaded twice", not "duplicate resolution".

---

## Code map

| File | Role |
|---|---|
| `src/tui/App.tsx` | Every screen, the keys and the layout |
| `src/tui/components.tsx` | `Panel`, `ListPanel`, `wrap` |
| `src/tui/theme.ts` | Colors |
| `src/tui/world.ts` | The model the screens render (`World`), doctor's issues placed on their rows, fixes, groups, search. No I/O of its own: an issue's fix runs health.ts's. |
| `src/tui/load.ts` | Fills a `World` from disk (plugins from `plugins.ts`' `installedPlugins` and `cursorPlugins`, issues from `health.ts`' `findIssues` and `usageIssues`); its `ops` make the other changes (through `library.ts`, `config.ts`, `plugins.ts`) |
| `src/tui/sample.ts` | A `World` in memory, for tests, `snapshot.tsx` and these screens, with what doctor would say about it written out |
| `src/tui/prompts.ts` | Review and write-a-skill prompts |
| `src/tui/snapshot.tsx` | Renders the app headless: `SIZE=118x30 STEPS='["enter","#a"]' npx tsx src/tui/snapshot.tsx` (`REAL=1` reads your machine instead) |
| `src/tui/design.ts` | The screens in this doc (`SCREENS`), and the ANSI → SVG conversion |

The contract between screens and data is `World` and its `Ops`. An op returns a message, or a message plus a follow-up fix (`{ message, then }`). The screens don't change the disk themselves: every change goes through an op. (They only check a file exists before opening it in `$EDITOR`.)

---

## Changing the design

1. Change `App.tsx` / `world.ts`. If the new state doesn't appear in the sample data, add it to `sample.ts`. A new kind of issue goes in `health.ts` (so doctor has it too), with its `at`, a short label in `shortOf`, and an example in `sample.ts`.
2. Add or update the screen in `SCREENS` (`src/tui/design.ts`). Steps are keys as `snapshot.tsx` takes them: `down up left right enter esc tab stab space bs`, or literal characters, space-separated (`"r e"` types `re`).
3. `pnpm design`, and look at the `.txt` files it changed.
4. Update this doc: the principle, place, issue or symbol it touches.
5. `pnpm test && pnpm type-check`.
