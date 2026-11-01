import { PluginSettingTab, Setting } from "obsidian";
import type { App, Plugin } from "obsidian";
import type { Settings } from "@hottasks/core";
import { HOUR_MS } from "@hottasks/core";

export interface SettingsHost extends Plugin {
  settings: Settings;
  updateSettings(patch: Partial<Settings>): Promise<void>;
}

function positiveNumber(value: string): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export class HotTasksSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly host: SettingsHost
  ) {
    super(app, host);
  }

  override display(): void {
    const { containerEl } = this;
    const s = this.host.settings;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Folder")
      .setDesc("Vault folder holding tasks.md, tasks-archive.md and history.")
      .addText((t) =>
        t.setValue(s.folder).onChange((v) => void this.host.updateSettings({ folder: v.trim().replace(/^\/+|\/+$/g, "") }))
      );

    new Setting(containerEl)
      .setName("Events kept after sweep")
      .setDesc("Newest events kept on each item, older ones go to the archive.")
      .addText((t) =>
        t.setValue(String(s.keepEvents)).onChange((v) => {
          const n = positiveNumber(v);
          if (n !== undefined) void this.host.updateSettings({ keepEvents: Math.floor(n) });
        })
      );

    new Setting(containerEl)
      .setName("Hot for (hours)")
      .setDesc("Items touched more recently than this are hot.")
      .addText((t) =>
        t.setValue(String(s.hotMs / HOUR_MS)).onChange((v) => {
          const n = positiveNumber(v);
          if (n !== undefined) void this.host.updateSettings({ hotMs: n * HOUR_MS });
        })
      );

    new Setting(containerEl)
      .setName("Warm for (hours)")
      .setDesc("Items touched more recently than this are warm, older ones are cold.")
      .addText((t) =>
        t.setValue(String(s.warmMs / HOUR_MS)).onChange((v) => {
          const n = positiveNumber(v);
          if (n !== undefined) void this.host.updateSettings({ warmMs: n * HOUR_MS });
        })
      );

    new Setting(containerEl)
      .setName("Terminal statuses")
      .setDesc("Comma separated. Items with one of these statuses stop counting toward heat.")
      .addText((t) =>
        t.setValue(s.terminalStatuses.join(", ")).onChange(
          (v) =>
            void this.host.updateSettings({
              terminalStatuses: v.split(",").map((x) => x.trim()).filter((x) => x !== "")
            })
        )
      );

    new Setting(containerEl)
      .setName("Daily snapshots")
      .setDesc("Copy tasks.md into history once per day before the first save.")
      .addToggle((t) => t.setValue(s.snapshots).onChange((v) => void this.host.updateSettings({ snapshots: v })));
  }
}
