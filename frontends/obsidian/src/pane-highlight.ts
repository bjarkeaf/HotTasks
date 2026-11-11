/**
 * Marks search hits in the list with the CSS Custom Highlight API, so the DOM is left untouched and
 * fields being edited keep their text exactly as typed.
 */
const NAME = "hottasks-search";

export function highlightMatches(root: HTMLElement, query: string): void {
  const registry = (globalThis.CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
  const HighlightCtor = (globalThis as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
  if (!registry || !HighlightCtor) return;
  const q = query.trim().toLowerCase();
  if (q === "") {
    registry.delete(NAME);
    return;
  }
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.nodeValue ?? "").toLowerCase();
    for (let at = text.indexOf(q); at !== -1; at = text.indexOf(q, at + q.length)) {
      const r = document.createRange();
      r.setStart(node, at);
      r.setEnd(node, at + q.length);
      ranges.push(r);
    }
  }
  registry.set(NAME, new HighlightCtor(...ranges));
}
