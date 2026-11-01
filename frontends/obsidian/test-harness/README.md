# Pane test harness

Runs the real pane sources in headless Edge with a stubbed `obsidian` module (async `MarkdownRenderer.render`) and the real core `Store` over an in-memory file. Real mouse and key input goes in over CDP.

```
cd frontends/obsidian/test-harness
node build.mjs                 # bundle, with trace calls injected into the bundle only
node run.mjs --guard=off       # 9 click scenarios x 4 render modes, guard in liveEdit disabled
node run.mjs --trace --only=6  # print the handler trace for one scenario
```

Exit code 1 and `LOST` lines mean the Info block did not survive. Needs Node 22+ and Edge at the default path.
