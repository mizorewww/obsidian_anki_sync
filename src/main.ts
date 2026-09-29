import {MarkdownView, Notice, Platform, Plugin, TAbstractFile, TFile} from "obsidian";
import {QuickCardModal} from "./card-creator";
import {registerCardPreview} from "./preview";
import {AnkiSyncService, formatSummary} from "./sync";
import {AnkiSyncSettings, AnkiSyncSettingTab, DEFAULT_SETTINGS} from "./settings";
import {errorMessage} from "./utils";

export default class ObsidianAnkiSyncPlugin extends Plugin {
	settings: AnkiSyncSettings;
	private readonly autoSyncTimers = new Map<string, number>();
	private readonly ignoredAutoSyncPaths = new Set<string>();

	async onload(): Promise<void> {
		await this.loadSettings();

		this.addRibbonIcon("square-plus", "Create Anki card", () => {
			this.openQuickCardModal();
		});

		this.addCommand({
			id: "create-anki-card",
			name: "Create Anki card",
			checkCallback: (checking) => {
				const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				const file = markdownView?.file;
				if (!file || file.extension !== "md") return false;
				if (!checking) this.openQuickCardModal();
				return true;
			},
		});

		if (this.canUseAnkiConnect()) {
			this.addRibbonIcon("refresh-cw", "Sync all pages to Anki", () => {
				void this.syncAllFiles();
			});

			this.addCommand({
				id: "sync-current-page",
				name: "Sync current page to Anki",
				checkCallback: (checking) => {
					const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
					const file = markdownView?.file;
					if (!file || file.extension !== "md") return false;
					if (!checking) void this.syncCurrentFile(file);
					return true;
				},
			});

			this.addCommand({
				id: "sync-all-pages",
				name: "Sync all pages to Anki",
				callback: () => {
					void this.syncAllFiles();
				},
			});
		}

		registerCardPreview(this, this.app, () => this.settings.rootDeckName);
		this.registerEditorMenu();
		this.registerEvent(this.app.vault.on("modify", (file) => this.handleFileModified(file)));
		this.registerEvent(this.app.vault.on("rename", (file) => this.handleFileRenamed(file)));
		this.register(() => this.clearAutoSyncTimers());
		this.addSettingTab(new AnkiSyncSettingTab(this.app, this));
	}

	onunload(): void {
		this.clearAutoSyncTimers();
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<AnkiSyncSettings>);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	private async syncCurrentFile(file: TFile, silent = false): Promise<void> {
		if (!this.canUseAnkiConnect()) {
			if (!silent) new Notice("Anki connect sync is disabled on mobile.");
			return;
		}

		const notice = silent ? null : new Notice("Syncing current page to Anki...", 0);
		try {
			const service = this.createSyncService();
			const summary = await service.syncCurrentFile(file, {
				silent,
				onBeforeWrite: (changedFile) => this.ignoredAutoSyncPaths.add(changedFile.path),
			});

			const message = summary.cards === 0
				? "No cards found in this page."
				: `Anki sync complete: ${formatSummary(summary)}.`;
			if (notice) {
				notice.setMessage(message);
				window.setTimeout(() => notice.hide(), 3500);
			} else if (!silent) {
				new Notice(message);
			}
		} catch (error) {
			notice?.hide();
			new Notice(`Anki sync failed: ${errorMessage(error)}`, 8000);
			console.error(error);
		}
	}

	private async syncAllFiles(): Promise<void> {
		if (!this.canUseAnkiConnect()) {
			new Notice("Anki connect sync is disabled on mobile.");
			return;
		}

		const notice = new Notice("Syncing all pages to Anki...", 0);
		try {
			const service = this.createSyncService();
			const summary = await service.syncAllFiles({
				onBeforeWrite: (changedFile) => this.ignoredAutoSyncPaths.add(changedFile.path),
			});
			notice.setMessage(`Anki sync complete: ${formatSummary(summary)} across ${summary.scannedFiles} file(s).`);
			window.setTimeout(() => notice.hide(), 5000);
		} catch (error) {
			notice.hide();
			new Notice(`Anki sync failed: ${errorMessage(error)}`, 8000);
			console.error(error);
		}
	}

	private handleFileModified(file: TAbstractFile): void {
		if (!(file instanceof TFile) || file.extension !== "md") return;
		if (this.ignoredAutoSyncPaths.delete(file.path)) return;
		if (!this.canUseAnkiConnect()) return;
		if (!this.settings.autoSyncOnSave) return;

		this.queueAutoSync(file);
	}

	private handleFileRenamed(file: TAbstractFile): void {
		if (!(file instanceof TFile) || file.extension !== "md") return;
		if (!this.canUseAnkiConnect()) return;
		if (!this.settings.autoSyncOnSave) return;
		this.queueAutoSync(file);
	}

	private queueAutoSync(file: TFile): void {
		const existingTimer = this.autoSyncTimers.get(file.path);
		if (existingTimer !== undefined) {
			window.clearTimeout(existingTimer);
		}

		const timer = window.setTimeout(() => {
			this.autoSyncTimers.delete(file.path);
			void this.syncCurrentFile(file, true);
		}, 1200);

		this.autoSyncTimers.set(file.path, timer);
	}

	private createSyncService(): AnkiSyncService {
		return new AnkiSyncService(this.app, this.settings);
	}

	private openQuickCardModal(): void {
		const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
		const selectedText = markdownView?.editor.getSelection();
		const initialText = selectedText?.trim() ? selectedText : undefined;

		new QuickCardModal(this.app, ({file, shouldSync}) => {
			new Notice("Anki card inserted.");
			if (shouldSync) {
				void this.syncCurrentFile(file);
			}
		}, (file) => this.ignoredAutoSyncPaths.add(file.path), {
			allowSync: this.canUseAnkiConnect(),
			file: markdownView?.file ?? null,
			editor: markdownView?.editor,
			initialText,
		}).open();
	}

	private registerEditorMenu(): void {
		this.registerEvent(this.app.workspace.on("editor-menu", (menu, editor, view) => {
			if (!(view instanceof MarkdownView)) return;
			if (!editor.getSelection().trim()) return;

			menu.addItem((item) => item
				.setTitle("Create Anki card")
				.setIcon("square-plus")
				.onClick(() => {
					this.openQuickCardModal();
				}));
		}));
	}

	private clearAutoSyncTimers(): void {
		for (const timer of this.autoSyncTimers.values()) {
			window.clearTimeout(timer);
		}
		this.autoSyncTimers.clear();
	}

	private canUseAnkiConnect(): boolean {
		return !Platform.isMobileApp;
	}
}
