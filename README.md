# HotTasks

A follow-up tracker where the main view is how long since you last touched each thing.

Most of the work in a large organisation is chasing: an approval sitting with someone, a part number waiting on a drawing, a supplier who has not answered. HotTasks keeps those threads in one plain Markdown file and colours each one by how long it has been since you did anything about it. Hot means you touched it recently. Cold means it is slipping.

- Plain Markdown storage, readable without the tool
- Heat measured from timestamps, not set by hand
- Items carry an outside status, a trail of events and a next action
- Backend separate from frontends, so several interfaces can share one file

## Layout

- `docs/backend-spec.md`: data model, markup, files, operations, API
- `docs/frontend-spec.md`: what any interface must show and allow
- `docs/plan.md`: build order
- `core/`: the backend library
- `frontends/`: one folder per interface
