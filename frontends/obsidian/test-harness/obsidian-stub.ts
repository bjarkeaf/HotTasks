// Minimal stand-in for the obsidian module. MarkdownRenderer.render is async like Obsidian's.
declare global {
  interface Window {
    __md: { mode: "append" | "empty"; delay: number };
    __trace: (...a: unknown[]) => void;
  }
  interface HTMLElement {
    addClass(c: string): void;
  }
}
HTMLElement.prototype.addClass = function (c: string) {
  this.classList.add(c);
};

export class Component {}
export class Notice {
  constructor(public msg: string) {
    window.__trace("Notice", msg);
  }
}
export class TFile {}
export class MarkdownView {}
export class Modal {
  contentEl = document.createElement("div");
  constructor(public app: unknown) {}
  open() {}
  close() {}
}
export class WorkspaceLeaf {}
export class ItemView extends Component {
  contentEl = document.createElement("div");
  app: any = { workspace: { activeLeaf: null } };
  constructor(public leaf: WorkspaceLeaf) {
    super();
    this.app.workspace.activeLeaf = leaf;
  }
  registerDomEvent(el: EventTarget, type: string, fn: (e: any) => void, opts?: boolean | AddEventListenerOptions) {
    el.addEventListener(type, fn, opts);
  }
  registerInterval(id: number) {
    return id;
  }
}
export const MarkdownRenderer = {
  async render(_app: unknown, md: string, el: HTMLElement, _path: string, _c: unknown): Promise<void> {
    window.__trace("MarkdownRenderer.render start", { connected: el.isConnected });
    await new Promise((r) => setTimeout(r, window.__md.delay));
    if (window.__md.mode === "empty") el.replaceChildren();
    for (const para of md.split(/\n\n/)) {
      const d = document.createElement("div");
      const m = /^(.*?)\[([^\]]+)\]\(([^)]+)\)(.*)$/.exec(para);
      if (m) {
        d.append(m[1]!);
        const a = document.createElement("a");
        a.href = m[3]!;
        a.textContent = m[2]!;
        a.className = "external-link";
        d.append(a, m[4]!);
      } else d.textContent = para;
      el.appendChild(d);
    }
    window.__trace("MarkdownRenderer.render appended", { connected: el.isConnected, live: el.classList.contains("hottasks-live"), children: el.childElementCount });
  }
};
export class Setting {}
export class PluginSettingTab {}
