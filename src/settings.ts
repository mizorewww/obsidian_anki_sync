import {App, Plugin, PluginSettingTab, Setting} from "obsidian";
import {DEFAULT_ANKI_CONNECT_URL, DEFAULT_ROOT_DECK} from "./constants";

export interface AnkiSyncSettings {
	ankiConnectUrl: string;
	rootDeckName: string;
	autoSyncOnSave: boolean;
	confirmBeforeDelete: boolean;
}

export const DEFAULT_SETTINGS: AnkiSyncSettings = {
	ankiConnectUrl: DEFAULT_ANKI_CONNECT_URL,
	rootDeckName: DEFAULT_ROOT_DECK,
	autoSyncOnSave: false,
	confirmBeforeDelete: true,
};

export interface SettingsHost {
	settings: AnkiSyncSettings;
	saveSettings(): Promise<void>;
}

export class AnkiSyncSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: Plugin & SettingsHost,
	) {
		super(app, plugin);
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Connection")
			.setHeading();

		new Setting(containerEl)
			.setName("Anki connect endpoint")
			.setDesc("Local Anki connect endpoint.")
			.addText((text) => {
				text
					.setPlaceholder(DEFAULT_ANKI_CONNECT_URL)
					.setValue(this.plugin.settings.ankiConnectUrl)
					.onChange(async (value) => {
						this.plugin.settings.ankiConnectUrl = value.trim() || DEFAULT_ANKI_CONNECT_URL;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Root deck")
			.setDesc("Cards sync into this Anki deck, with the Obsidian path mirrored below it.")
			.addText((text) => {
				text
					.setPlaceholder(DEFAULT_ROOT_DECK)
					.setValue(this.plugin.settings.rootDeckName)
					.onChange(async (value) => {
						this.plugin.settings.rootDeckName = value.trim() || DEFAULT_ROOT_DECK;
						await this.plugin.saveSettings();
					});
			});

			new Setting(containerEl)
				.setName("Sync on save")
				.setDesc("Automatically sync Markdown files that contain a cards section after they are saved.")
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.autoSyncOnSave)
					.onChange(async (value) => {
						this.plugin.settings.autoSyncOnSave = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Confirm before deleting")
			.setDesc("Ask before deleting Obsidian-managed notes that no longer exist in Markdown.")
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.confirmBeforeDelete)
					.onChange(async (value) => {
						this.plugin.settings.confirmBeforeDelete = value;
						await this.plugin.saveSettings();
					});
			});
	}
}
