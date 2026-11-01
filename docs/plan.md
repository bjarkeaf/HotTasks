# HotTasks plan

## 1. Core

- Parser and serializer for `tasks.md` with round-trip tests on real files
- Model, IDs, lanes, status
- Heat and roll-up
- Operations from backend spec section 4
- Archive, trim, snapshot, sweep
- History lookup across live file and archive
- Disk watcher so hand edits are picked up

## 2. Obsidian editor frontend

- Load core inside an Obsidian plugin
- Heat colour per item line, relative times, hidden IDs and `@`
- Render `[>]` as Later
- Right-click menu and hotkeys for lane, status, event, touch, task, fact
- Timestamp insertion on Enter in the event block
- Send-to-tasks command on any bullet in any note
- History popup

## 3. Migration

- One-off script that takes the Task status section of the latest daily note and writes a first `tasks.md`
- `/next-day-note` stops carrying tasks and only carries meeting notes

## 4. Second frontend

- Obsidian pane with lanes as columns, sorted by heat
- Compare against the editor frontend using the frontend spec checklist

## 5. Connectors

- Agile: status sync for MCO, ECO, NPR, DEV through the read-only agile-tools `brief` command, see docs/connectors/agile-status.md (local only)
- Agile: live signer list as details
- Windchill: status sync once a read path exists

## Not planned

Due dates beyond not-before, reminders, charts, sync to Teams or Outlook. Add only when the same annoyance comes up twice.
