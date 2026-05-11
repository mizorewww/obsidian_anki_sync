import {MarkdownView, Notice, Plugin, TAbstractFile, TFile} from "obsidian";
import {registerCardPreview} from "./preview";
import {AnkiSyncService, formatSummary} from "./sync";
import {AnkiSyncSettings, AnkiSyncSettingTab, DEFAULT_SETTINGS} from "./settings";

export default class ObsidianAnkiSyncPlugin extends Plugin {
	settings: AnkiSyncSettings;
	private readonly autoSyncTimers = new Map<string, number>();
	private readonly ignoredAutoSyncPaths = new Set<string>();

	async onload(): Promise<void> {
		await this.loadSettings();

		this.addRibbonIcon("refresh-cw", "Sync current page to Anki", () => {
			const file = this.app.workspace.getActiveFile();
			if (file?.extension === "md") {
				void this.syncCurrentFile(file);
			} else {
				new Notice("Open a Markdown note before syncing.");
			}
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

		registerCardPreview(this, this.app);
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
		if (!this.settings.autoSyncOnSave) return;

		if (this.ignoredAutoSyncPaths.has(file.path)) {
			this.ignoredAutoSyncPaths.delete(file.path);
			return;
		}

		this.queueAutoSync(file);
	}

	private handleFileRenamed(file: TAbstractFile): void {
		if (!(file instanceof TFile) || file.extension !== "md") return;
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

	private clearAutoSyncTimers(): void {
		for (const timer of this.autoSyncTimers.values()) {
			window.clearTimeout(timer);
		}
		this.autoSyncTimers.clear();
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
