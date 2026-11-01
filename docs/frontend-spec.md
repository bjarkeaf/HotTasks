# HotTasks frontend spec

A frontend is any interface over the backend. Several may exist at once and are compared against this list. It says what a frontend must show and allow, not how. Section 7 records the interaction rules settled while prototyping the pane, which any frontend with a graphical list should follow.

## 1. Must show

For every item:

- Name, and the workstream it belongs to
- Lane
- Status, if set
- Every open task, each with a checkbox, and today's finished tasks ticked and struck through
- Heat, as a colour and as a readable duration such as 25 min, 3 h, 4 d, or parked until Sunday
- The newest event, with its date and time

For every workstream:

- Name, in a colour that is stable for that workstream
- Rolled-up lane when it is not Now. Rolled-up heat is not repeated on the header, the item blocks beneath already show it

The heat colours come from the backend thresholds, so every frontend shows the same item the same colour.

Info and older events may be hidden by default but must be one action away.

## 2. Must allow

- Change an item's lane
- Change an item's status
- Add an event, with the current date and time prefilled and editable, so something from yesterday can be logged
- Edit an event's text and time, and remove an event
- Touch an item, meaning add an event with the current time and no text
- Add, edit, remove and complete tasks, and reopen a task finished today
- Edit the info block
- Add an item, with or without a workstream
- Add, rename, recolour and delete a workstream, with confirmation before deleting
- Rename an item and delete it, with confirmation
- View the history of an item, merged from the live file and the archive
- Send a bullet from another note to tasks, as a new item
- Run the sweep on demand

Each of these goes through a backend operation. A frontend never edits the files directly.

## 3. Must not

- Hold state the backend does not have, apart from presentation preferences such as workstream colours
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
| Obsidian pane | The main view. A side pane with items grouped by workstream, heat block per item, everything editable in place. Prototyped in `docs/mock/pane-mock.html`. |
| Obsidian editor | Decorations on `tasks.md` in the editor: heat colour in the gutter, relative times, hidden syntax. The fallback view when the file itself is open. |
| Web | A local page over the same folder. Full layout freedom, no Obsidian. |

## 7. Interaction rules

Settled on the pane mock. The words used in the interface are the spec's: Workstream, Item, Task, Info, Event, Lane, Status.

**Layout**

- Default view groups items by workstream and keeps the order of the file, so positions stay familiar. A second view lists items flat, coldest first.
- Default lane shown is Now alone. A lane menu offers checkboxes to combine lanes and a click on a lane name to show only that lane. When several lanes show, each is a section with a band heading. Done items are dimmed.
- A workstream is a box: a left edge and tinted header in its colour, name, count, and on hover a plus to add an item and a cross to delete. Items without a workstream sit in a plain box at the end. Empty workstreams sit at the bottom, outside the lanes.
- A row shows name and status on the first line, the task list beneath, the newest event beneath that as a quiet third line, and the heat block flush against the right edge spanning the row. The item cross sits at the top right of the row, left of the heat block, on hover.
- Toolbar holds the name and three icons: add workstream, sort, lanes. Counts by heat and a search field live in a footer.

**Editing**

- Text is edited in place: click the name, status, a task, the info block, an event's text or an event's time and that text itself becomes editable where it sits, selected, with a thin accent underline. Enter or a click elsewhere saves, Escape cancels. One click elsewhere both saves and acts on what was clicked.
- Empty fields show a placeholder in grey italic, which switches to normal text the moment typing starts.
- Spots that accept new text are marked with a dashed underline, never a box: the add-task line, the new-event line, empty info.
- Names and statuses never wrap. Limits from the backend spec section 9 apply while typing. Longer text from the file is shown in full with a wavy mark and a tooltip, and is not cut when edited.

**Tasks**

- Ticking a task's checkbox completes it. It stays in the list ticked and struck through until midnight, then appears only in Events. Unticking reopens it.
- A task can be ticked from a closed row as well as an open one. Each task has a cross to remove it without a record.
- The add-task line has a live checkbox: ticking it logs the typed text as done at once, without it ever being an open task.

**Events**

- The newest event is first in the list. The new-event line sits above the list and matches its columns: date and time on the left, prefilled with now in the same short form, then the text.
- Times show as `MM-DD HH:MM`, with the year only when it differs from the current year. The file always holds the full date. Time input accepts `10:30`, `yesterday 14:00`, `2 h ago`, `10-28 09:15` and `2026-10-28 09:15`.
- Each event has a cross on hover. Removing the newest `Touched` is how an accidental touch is undone.

**Touch**

- Clicking the heat block touches the item. No separate button. Double-clicking a row touches it too.

**Opening and closing**

- Clicking the whitespace of a row opens it. Clicking anywhere outside closes it. Clicking text that is editable edits it without opening.
- Open items show, in order: name line, tasks with the add-task line, Info, Events.

**Popovers and menus**

- Creation and confirmation popovers open right-aligned under their button so the confirm button is under the cursor. Menus stay open while options are clicked and close on a click elsewhere or Escape.
- Deleting an item or workstream asks first and archives rather than erases.
