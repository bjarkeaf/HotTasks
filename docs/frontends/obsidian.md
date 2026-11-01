# Obsidian editor frontend

Decorations on `tasks.md` in the Obsidian editor, plus commands that call the backend. Source in `frontends/obsidian/`.

## Must show (frontend spec section 1)

| Line | Status |
|---|---|
| Name | Met, it is the line text |
| Workstream | Met, the parent line in the file |
| Lane | Met, `[>]` shows a Later badge and done lines are struck through |
| Status | Met, it stays in the line text as `: *Status*` |
| Task with relative not-before | Partly, the `@date` shows as today, in N d or N d ago |
| Heat colour and duration | Met, gutter bar plus 25 min, 3 h, 4 d or parked until a date, from backend thresholds |
| Newest event | Met by the event lines under the item, no separate summary |
| Workstream name, rolled-up lane and heat | Missing, no rollup shown on workstream lines |
| Facts and older events one action away | Met, they are plain lines in the editor |

## Must allow (section 2)

| Line | Status |
|---|---|
| Change lane | Met, three commands |
| Change status | Missing, edit the line text and save |
| Add event | Partly, command with a text prompt, always the current time |
| Touch | Met |
| Set or edit task, relative not-before words | Missing |
| Add fact | Missing |
| Add item | Missing |
| Rename | Missing |
| History merged from file and archive | Met, popup |
| Send a bullet from another note | Missing |
| Run sweep | Met |

## Beyond the spec

Hidden `^ws-` and `^it-` IDs and relative `@` timestamps, both revealed as raw text while the cursor is on the line. Hand edits to `tasks.md` are picked up through the vault modify event. Settings for folder, kept events, hot and warm hours, terminal statuses and daily snapshots.

Not done yet: right-click menu, task editing, facts, status editing from the UI, reading view.

Commands act on the nearest item line at or above the cursor. They save the open file first, run the backend operation, and the backend writes the file back. An item without an ID gets one on the first command.

## Install

1. `npm install` at the repo root
2. `npm run build -w @hottasks/core` then `npm run build -w @hottasks/obsidian`
3. `npm run install:vault -w @hottasks/obsidian`, set `HOTTASKS_VAULT_PLUGIN_DIR` to install somewhere other than the default vault
4. In Obsidian, turn restricted mode off and enable HotTasks under community plugins

Use `npm run dev -w @hottasks/obsidian` to rebuild on change.
