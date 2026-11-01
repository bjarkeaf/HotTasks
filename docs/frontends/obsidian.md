# Obsidian frontend

Two views over the same backend, in one plugin. The pane is the main view, a side pane with items grouped by workstream, everything editable in place. The editor decorations are the fallback when `tasks.md` itself is open. Source in `frontends/obsidian/`, the pane in `pane*.ts`, the interaction rules in frontend spec section 7, the approved prototype in `docs/mock/pane-mock.html`.

## Must show (frontend spec section 1)

| Line | Pane | Editor |
|---|---|---|
| Name and workstream | Met | Met, line text and parent line |
| Lane | Met, Later chip, done items dimmed and struck through | Met, badge and strike-through |
| Status | Met, next to the name | Met, stays in the line text |
| Open tasks with checkbox, today's finished tasks ticked | Met | Partly, plain lines, `@date` shows relative |
| Heat as colour and duration, parked until a date | Met, heat block on the right, backend thresholds | Met, gutter bar and age |
| Newest event with date and time | Met, third line of the row | Met, the event lines |
| Workstream name in a stable colour | Met, hue from a hash of the ID, recolour in the header | Missing |
| Workstream rolled-up lane and heat | Met, chip in the header | Missing |
| Info and older events one action away | Met, open the row, newest 4 events then show all | Met, plain lines |

## Must allow (section 2)

| Line | Pane | Editor |
|---|---|---|
| Change lane | Met, right-click menu | Met, three commands |
| Change status | Met, click it | Missing, edit the line |
| Add event with editable time | Met, new-event line with `10:30`, `yesterday 14:00`, `2 h ago`, `10-28 09:15`, `2026-10-28 09:15` | Partly, command, always now |
| Edit and remove an event | Met, click text or time, cross on hover | Missing |
| Touch | Met, click the heat block or double-click the row | Met |
| Add, edit, remove, complete, reopen task | Met, see below for dates | Missing |
| Edit info | Met, one block | Missing |
| Add item, with or without workstream | Met, plus in a workstream header or in the plain box | Missing |
| Add, rename, recolour, delete workstream | Met | Missing |
| Rename and delete item | Met | Missing |
| History merged from file and archive | Met, right-click menu | Met, command |
| Send a bullet from another note | Missing | Missing |
| Run sweep | Command "Sweep now" | Command "Sweep now" |

## Beyond the spec

- Sort by workstream or coldest first, lane menu with combinable lanes, search and heat counts in the footer. View, lanes, open item and search text are kept between sessions.
- Open in note puts the cursor on the item's line in `tasks.md`.
- Hidden `^ws-` and `^it-` IDs and relative `@` timestamps in the editor, revealed while the cursor is on the line.
- Hand edits to `tasks.md` are picked up through the vault modify event, and the pane redraws without losing the open row or a half-typed field.
- Settings for folder, kept events, hot and warm hours, terminal statuses and daily snapshots.

## How the pane behaves

Every action applies a backend operation to the in-memory model, redraws at once and then saves through the store. If the file changed on disk the store reloads and the pane says "File changed on disk, try again". Saves run one after the other.

Deleting an item or workstream asks first, then sets its items to Done, so the next sweep archives them. A workstream that is already empty is removed from the file. A workstream whose items were archived by a sweep shows under Empty workstreams and can be deleted from there. There is no delete operation in the backend by design.

Events have no edit or remove operation in the backend yet, so the pane edits the event list of the model directly. It still never writes a file itself.

Rows without an ID get one when the pane opens, by saving once. Workstream colour overrides are kept in the plugin data as `wsHues`, keyed by workstream ID.

## Not done yet

- Send to tasks from another note, as a command or as drag and drop
- Setting a not-before date on a task. An existing date is shown and kept when the task is edited
- Reading-view decorations for `tasks.md`
- Colour and rollup in the editor decorations
- Not checked against a running Obsidian, only against a browser harness with the plugin's own styles

## Install

1. `npm install` at the repo root
2. `npm run build`
3. `npm run install:vault -w @hottasks/obsidian`, set `HOTTASKS_VAULT_PLUGIN_DIR` to install somewhere other than the default vault. It copies `dist/main.js`, `manifest.json` and `styles.css`.
4. In Obsidian, turn restricted mode off and enable HotTasks under community plugins
5. Click the flame icon in the ribbon, or run "Open HotTasks pane", to open the pane in the right sidebar

Use `npm run dev -w @hottasks/obsidian` to rebuild on change.
