import { Modal, Setting } from "obsidian";
import type { App } from "obsidian";
import type { HistoryEvent } from "@hottasks/core";
import { formatTimestamp } from "@hottasks/core";

export class TextModal extends Modal {
  private value = "";

  constructor(
    app: App,
    private readonly title: string,
    private readonly onSubmit: (text: string) => void
  ) {
    super(app);
  }

  override onOpen(): void {
    this.setTitle(this.title);
    const submit = () => {
      this.close();
      this.onSubmit(this.value.trim());
    };
    new Setting(this.contentEl).addText((text) => {
      text.onChange((v) => (this.value = v));
      text.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") submit();
      });
      text.inputEl.focus();
    });
    new Setting(this.contentEl).addButton((b) => b.setButtonText("Add").setCta().onClick(submit));
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

export class HistoryModal extends Modal {
  constructor(
    app: App,
    private readonly name: string,
    private readonly events: HistoryEvent[]
  ) {
    super(app);
  }

  override onOpen(): void {
    this.setTitle(this.name);
    if (this.events.length === 0) {
      this.contentEl.createEl("p", { text: "No events." });
      return;
    }
    const list = this.contentEl.createEl("ul", { cls: "hottasks-history" });
    for (const e of this.events) {
      const when = e.at ? formatTimestamp(e.at) : "";
      const li = list.createEl("li", { text: `${when} ${e.text}`.trim() });
      if (e.source === "archive") li.addClass("hottasks-archived");
    }
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
