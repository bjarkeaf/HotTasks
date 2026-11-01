# HotTasks backend spec

The backend is a library with no user interface and no dependency on any editor. It owns the files, the parser, the model and every operation that changes state. Frontends call it and never write the files themselves.

## 1. Model

### Levels

| Level | What it is |
|---|---|
| Workstream | An optional grouping of items. A project, a part, a person. Has a name and an ID, nothing else. |
| Item | One line of follow-up. The unit that carries lane, status and heat. |
| Task | A next action on an item. Zero or more per item, in order. |
| Info | Free text that stays with the item for its whole life. Zero or more lines per item, shown to the user as one block. |
| Event | Something that happened, with a timestamp. Zero or more per item, ordered oldest to newest. |

A workstream contains items. An item contains tasks, info and events, in that order. An item may stand alone at top level without a workstream.

What a bullet is follows from what is under it, not from its depth. A bullet whose children are tasks, info or events is an item. A bullet whose children are items is a workstream.

Finishing a task is an event, `Done: <task text>`, written at the moment the task is removed. Frontends show today's `Done:` events as ticked tasks until the day ends, and reopening one deletes the event and restores the task line.

### Properties of an item

| Property | Set by | Values |
|---|---|---|
| Lane | User | Now, Later, Done |
| Status | User or connector, optional | Free text, usually the state in an outside system such as Agile or PDP |
| Heat | Backend | Time since the newest timestamp under the item |
| ID | Backend | Stable identifier, assigned on first save |

A workstream has only a name and an ID. Everything a frontend shows for a workstream is rolled up from its items.

### Roll-up rules

- Workstream lane: the most urgent lane among its open items, in the order Now, Later. A workstream with only Done items is Done.
- Workstream heat: the hottest among its open items.
- Items with a terminal status (see 6) do not count toward workstream heat.

## 2. Markup

One file, `tasks.md`, in Markdown. Tabs or spaces for indentation, the parser accepts either and the serializer preserves what the file uses.

```markdown
## Task status

- Molex D-sub 15 - 065-1271-000 ^ws-k3f2
	- [ ] MCO-042063: *QA Review* ^it-9q7d
		- **Follow up with Ronen** @2026-11-02
		- Needs 'NPR released in PDP' set before it can promote
		- @2026-10-13 13:30 Reminded Ronen
		- @15:17 Shani reminded to sign for T2P_Change_Analyst
	- [>] Alternative parts ^it-2m8c
		- **Check if LO matches between CviLux and Molex**
		- Ronen: AMTEK out, CviLux potential 2nd source
- [ ] Lab PCs ^it-7x1a
	- **Follow up with Brian in person**
	- @2026-10-14 08:00 Request sent on Teams
```

### Line rules

| Line | Form |
|---|---|
| Workstream | Plain bullet, no checkbox. Name, then ID. |
| Item | Checkbox bullet. `[ ]` Now, `[>]` Later, `[x]` Done. Name, optional `: *Status*`, then ID. |
| Task | Bold bullet under the item, above the first event. Several allowed. Optional trailing `@date` meaning not before that date. |
| Info | Plain bullet under the item, above the first event. |
| Event | Bullet starting with a timestamp, `@HH:MM` or `@YYYY-MM-DD HH:MM`. |

The event block starts at the first timestamped line under an item and runs to the end of the item. A line inside the event block with no timestamp is still an event. Its time for heat purposes is the timestamp of the nearest timestamped line above it. A line above the first timestamped line is a task if bold, otherwise info.

Bare `@HH:MM` means that time on the day of the file's most recent save for new lines, and is expanded to the full form by the backend on save, so the file on disk only ever holds full timestamps. Frontends may show full timestamps as relative time.

A date without a time counts as the end of that day.

### IDs

Obsidian block ID syntax, a caret and a short string at the end of the line. Prefix `ws-` for workstreams and `it-` for items, followed by four lowercase alphanumeric characters. The backend assigns an ID to any workstream or item line that has none when it saves. IDs are never reused. Names are labels and may change freely.

### Headings

Headings are allowed and ignored by the model, with one exception for compatibility with hand-written files: a plain bullet with no checkbox that turns out to be an item takes its lane from the heading above it, Later under a heading whose text contains "later" or "not urgent", Done under a heading containing "done". Once a line has a checkbox, the checkbox is the only source of lane, so `[ ]` always means Now. On save the backend writes the lane into the checkbox and leaves the heading alone.

A heading ends the bullet tree above it. Blank lines and other non-bullet text do not, they stay attached to the bullet above them and are written back in place.

### Type by ID

A bullet whose ID starts with `ws-` is a workstream and one whose ID starts with `it-` is an item, whatever is under it. This keeps an empty workstream a workstream after a reload. The children rule above applies only to bullets without an ID.

### Round trip

Parsing a file and serializing the result must give back the same file, apart from these normalisations: bare timestamps expanded, missing IDs added, lane written into the checkbox, a checkbox added to a plain bullet that turned out to be an item, and tasks moved above info under their item. Unknown lines, blank lines and headings are preserved in place. Bullet markers (`-` or `*`), indentation characters and line endings are kept as found, except that a file with mixed line endings is written with one. A checkbox on a line nested under an item is kept as text.

Whitespace inside a line is not guaranteed: repeated spaces after a marker, trailing spaces, `[X]` for `[x]` and `_status_` for `*status*` are normalised.

## 3. Files

| File | Written by | Purpose |
|---|---|---|
| `tasks.md` | Backend, on behalf of frontends | The live list. The user may also edit it by hand. |
| `tasks-archive.md` | Backend only | Done items and trimmed events, appended, grouped by item ID. |
| `history/tasks-YYYY-MM-DD.md` | Backend, optional | A copy of `tasks.md` taken once per day on first save. Safety net for hand edits. |

The folder holding these is a setting. All three live together.

### Archive format

```markdown
## 2026-11-01

### it-9q7d MCO-042063 (Molex D-sub 15 - 065-1271-000)
- @2026-10-13 13:30 Reminded Ronen
- @2026-10-15 15:17 Shani reminded to sign for T2P_Change_Analyst
```

A `##` heading per day the backend archived something. A `###` heading per item, with its ID, its name at the time, and its workstream name in parentheses. Under it the lines that were removed from `tasks.md`, in their original form. When a whole item is archived, its tasks, info and events all go, with a final event recording the archive.

## 4. Operations

Every operation takes an item or workstream ID and edits the in-memory model, and where noted appends an event. Writing is the store's job: a frontend applies one or more operations and then calls `save()`. The store refuses to save over a file that changed on disk since it was read, reloads it instead and reports a conflict, so the frontend redoes the operation. Lane and status changes made by hand in the file get the same event the operation would have written, added by the store when it reloads. Events written by operations use a fixed vocabulary so history can be read by machine.

| Operation | Effect | Event written |
|---|---|---|
| `setLane(id, lane)` | Changes the checkbox | `Lane: Later`, `Lane: Now`, `Done` |
| `setStatus(id, text)` | Changes the italic status | `Status: <text>` |
| `addEvent(id, text, at?)` | Appends an event, timestamp defaults to now | the text itself |
| `touch(id)` | Appends an event with the current time and no other content. Meant for "looked at it, nothing to write" | `Touched` |
| `addTask(id, text, notBefore?)` | Appends a task | none |
| `editTask(id, index, text, notBefore?)` | Changes a task, empty text removes it | none |
| `removeTask(id, index)` | Removes a task without a trace | none |
| `completeTask(id, index)` | Removes the task and records it | `Done: <task text>` |
| `reopenTask(id, eventIndex)` | Deletes a `Done:` event and restores the task | none |
| `addInfo(id, text)` / `setInfo(id, lines)` | Adds one info line, or replaces the whole block | none |
| `rename(id, name)` | Changes the name on the line and rewrites it in the archive | none |
| `addItem(parentId?, name)` | Creates an item, assigns an ID, lane Now | none |
| `addWorkstream(name)` | Creates a workstream | none |
| `move(id, parentId?, index)` | Reorders or reparents | none |
| `moveItemAfter(id, parentId?, afterId)` | Places an item directly after a sibling, or first when `afterId` is null | none |
| `moveWorkstream(id, index)` | Reorders a workstream among the top-level lines | none |
| `moveWorkstreamAfter(id, afterId)` | Places a workstream directly after another, or first when `afterId` is null | none |
| `importBullet(text, parentId?)` | Takes a bullet with children from any note and creates an item from it | none |
| `history(id)` | Returns all events for an item from `tasks.md` and the archive, newest last | none |
| `sweep()` | Runs housekeeping, see 5 | per item as described |

## 5. Housekeeping

`sweep()` runs on the first save of each day in a session and on demand.

1. Archive every item whose lane is Done and whose Done event is older than today.
2. For every remaining item, move events beyond the newest N to the archive. N is a setting, default 3. Info and tasks are never trimmed.
3. Take the daily snapshot if enabled and not already taken today.
4. Rewrite names in the archive for any item renamed since the last sweep.

## 6. Heat

Heat is the elapsed time from now to the newest timestamp under the item, counting events and a dated task. It is reported as a duration, and frontends choose how to show it.

Rules:

- A task dated in the future parks the item. With several dated tasks the earliest date counts. Heat is reported as parked until that date, and from that date onward it is computed as if the item was touched at the start of that day.
- A status change counts as a touch, because the matching event carries a timestamp.
- An item with a terminal status does not report heat. Terminal statuses are a setting, default `Released`, `Rejected`, `Deleted`, `Cancelled`.
- An item with no timestamps at all reports heat as unknown.

The backend exposes thresholds from settings, default hot under 24 hours, warm under 72 hours, cold beyond, so that frontends agree on colours. Frontends may show finer detail.

## 7. Connectors

A connector is a module that knows how to read an outside system and map its records onto items.

- It recognises its items by a pattern in the name, for example `MCO-\d{6}`, `NPR\d{5}`, `ECO-\d{6}`.
- It calls `setStatus` when the outside state changes. Nothing else writes status from outside.
- It may supply live details for an item, such as who still needs to sign. Details are returned to frontends on request and cached in memory. They are never written to `tasks.md`.

Connectors run on a schedule or on demand. The first ones planned are Agile and Windchill.

## 8. API shape

The backend is a TypeScript package with no runtime dependencies. It exposes:

- `load(folder)`: reads the files and returns a model
- The operations in section 4 as methods on the model
- `heat(id, now?)` and `rollup(workstreamId, now?)`
- `settings`: event trim count, heat thresholds, terminal statuses, snapshot on or off, folder
- A change notification so frontends can redraw after any write, including writes caused by hand edits detected on disk

Frontends must not hold state that the backend does not have, with one exception: presentation preferences that have no place in Markdown, such as a chosen colour per workstream, live in the frontend's own settings keyed by ID.

## 9. Text limits

The file accepts any length. Frontends limit what can be typed so a row stays on one line: item name 32 characters, status 14, workstream name 24, task 80. Text that arrives longer than that from the file is shown in full and marked, never cut, and editing it keeps the full text while refusing to grow it.
