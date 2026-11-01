# HotTasks frontend spec

A frontend is any interface over the backend. Several may exist at once and are compared against this list. It says what a frontend must show and allow, not how.

## 1. Must show

For every item:

- Name, and the workstream it belongs to
- Lane
- Status, if set
- Task, if set, with its not-before date shown relative to today when there is one
- Heat, as a colour and as a readable duration such as 25 min, 3 h, 4 d, or parked until Sunday
- The newest event

For every workstream:

- Name
- Rolled-up lane and heat

The heat colours come from the backend thresholds, so every frontend shows the same item the same colour.

Facts and older events may be hidden by default but must be one action away.

## 2. Must allow

- Change an item's lane
- Change an item's status
- Add an event, with the current time by default and an editable time
- Touch an item, meaning add an event with the current time and no text
- Set or edit the task, including a not-before date typed as a relative word such as tomorrow or Sunday, stored absolute
- Add a fact
- Add an item, with or without a workstream
- Rename an item or workstream
- View the history of an item, merged from the live file and the archive
- Send a bullet from another note to tasks, as a new item
- Run the sweep on demand

Each of these goes through a backend operation. A frontend never edits the files directly.

## 3. Must not

- Hold state the backend does not have
- Write `tasks.md` or the archive except through the backend
- Change the meaning of any markup. A frontend may hide syntax such as IDs and the `@` on timestamps, but what is on disk is what the backend spec says

## 4. Should

- Update heat without user action, at least once a minute
- Show relative times that are correct right now, computed from the absolute timestamps on disk
- Keep the user's place and selection when the backend reports a change from disk

## 5. Per-frontend page

Each frontend has a page under `docs/frontends/` with:

- How it meets each line in sections 1 and 2, or which lines it does not meet yet
- What it adds beyond the spec
- How it is installed and run

That page is the basis for comparing frontends.

## 6. Planned frontends

| Frontend | Idea |
|---|---|
| Obsidian editor | Decorations on `tasks.md` in the editor: heat colour in the gutter, relative times, hidden syntax, right-click menu for operations. Closest to the raw file. |
| Obsidian pane | A board next to the note. Lanes as columns, items sorted by heat, drag between lanes. |
| Web | A local page over the same folder. Full layout freedom, no Obsidian. |
