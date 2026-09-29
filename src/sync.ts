import {App, Modal, Notice, Setting, TFile} from "obsidian";
import {AnkiConnectClient, AnkiNoteInfo, getManagedUuid} from "./anki";
import {extractPathFromTags, makePathTag} from "./tags";
import {parseCardsDocument, ParsedCard} from "./parser";
import {AnkiSyncSettings} from "./settings";

export interface SyncSummary {
	scannedFiles: number;
	cards: number;
	created: number;
	updated: number;
	modelChanged: number;
	deleted: number;
	pendingDelete: number;
	filesChanged: number;
}

export interface SyncRuntimeOptions {
	silent?: boolean;
	onBeforeWrite?: (file: TFile) => void;
}

export class AnkiSyncService {
	constructor(
		private readonly app: App,
		private readonly settings: AnkiSyncSettings,
	) {}

	async syncCurrentFile(file: TFile, options?: SyncRuntimeOptions): Promise<SyncSummary> {
		const summary = emptySummary();
		summary.scannedFiles = 1;

		const parsed = await this.parseFile(file, true, options);
		if (!parsed) return summary;

		summary.filesChanged += parsed.changed ? 1 : 0;
		summary.cards = parsed.cards.length;

		const client = await this.readyClient();
		if (parsed.cards.length > 0) {
			await client.validateCardsCanBeAdded(parsed.cards);
			await this.upsertCards(client, parsed.cards, summary);
		}

		const deleteCandidates = await this.currentPathDeleteCandidates(client, file.path, new Set(parsed.cards.map((card) => card.uuid)));
		summary.pendingDelete = deleteCandidates.length;
		await this.deleteCandidates(client, deleteCandidates, summary, options);

		return summary;
	}

	async syncAllFiles(options?: SyncRuntimeOptions): Promise<SyncSummary> {
		const summary = emptySummary();
		const desiredCards: ParsedCard[] = [];

		for (const file of this.app.vault.getMarkdownFiles()) {
			summary.scannedFiles += 1;
			const parsed = await this.parseFile(file, true, options);
			if (!parsed) continue;
			summary.filesChanged += parsed.changed ? 1 : 0;
			desiredCards.push(...parsed.cards);
		}

		summary.cards = desiredCards.length;
		const client = await this.readyClient();
		await client.validateCardsCanBeAdded(desiredCards);
		await this.upsertCards(client, desiredCards, summary);

		const desiredUuids = new Set(desiredCards.map((card) => card.uuid));
		const deleteCandidates = (await client.getManagedNotes()).filter((note) => {
			const uuid = getManagedUuid(note);
			return uuid === null || !desiredUuids.has(uuid);
		});

		summary.pendingDelete = deleteCandidates.length;
		await this.deleteCandidates(client, deleteCandidates, summary, options);
		return summary;
	}

	private async parseFile(file: TFile, ensureIdentities: boolean, options?: SyncRuntimeOptions) {
		const source = await this.app.vault.read(file);
		const parsed = parseCardsDocument(source, file.path, {
			ensureIdentities,
			rootDeckName: this.settings.rootDeckName,
		});

		if (parsed.changed) {
			options?.onBeforeWrite?.(file);
			await this.app.vault.modify(file, parsed.updatedSource);
		}

		return parsed.cardsSection ? parsed : null;
	}

	private async readyClient(): Promise<AnkiConnectClient> {
		const client = new AnkiConnectClient(this.settings.ankiConnectUrl);
		await client.version();
		await client.verifyModernModels();
		return client;
	}

	private async upsertCards(client: AnkiConnectClient, cards: ParsedCard[], summary: SyncSummary): Promise<void> {
		for (const card of cards) {
			const result = await client.upsertCard(card);
			if (result.created) {
				summary.created += 1;
			} else {
				summary.updated += 1;
			}
			if (result.modelChanged) summary.modelChanged += 1;
		}
	}

	private async currentPathDeleteCandidates(client: AnkiConnectClient, path: string, desiredUuids: Set<string>): Promise<AnkiNoteInfo[]> {
		const notes = await client.getManagedNotesForPathTag(makePathTag(path));
		return notes.filter((note) => {
			const uuid = getManagedUuid(note);
			return uuid === null || !desiredUuids.has(uuid);
		});
	}

	private async deleteCandidates(client: AnkiConnectClient, candidates: AnkiNoteInfo[], summary: SyncSummary, options?: SyncRuntimeOptions): Promise<void> {
		if (candidates.length === 0) return;

		const confirmed = !this.settings.confirmBeforeDelete || await confirmDelete(this.app, candidates);

		if (!confirmed) {
			if (!options?.silent) new Notice(`Skipped deleting ${candidates.length} Anki note(s).`);
			return;
		}

		await client.deleteNotes(candidates.map((candidate) => candidate.noteId));
		summary.deleted += candidates.length;
	}
}

class DeleteConfirmationModal extends Modal {
	private resolved = false;

	constructor(
		app: App,
		private readonly candidates: AnkiNoteInfo[],
		private readonly resolve: (confirmed: boolean) => void,
	) {
		super(app);
	}

	onOpen(): void {
		const {contentEl} = this;
		const count = this.candidates.length;
		contentEl.empty();
		this.setTitle("Delete Anki notes");
		contentEl.createEl("p", {
			text: `${count} Obsidian-managed Anki note${count === 1 ? "" : "s"} no longer exist in Markdown.`,
		});

		const previewList = contentEl.createDiv({cls: "oas-delete-preview-list"});
		for (const candidate of this.candidates) {
			previewList.appendChild(renderDeletePreview(candidate));
		}

		new Setting(contentEl)
			.addButton((button) => button
				.setButtonText("Cancel")
				.onClick(() => this.finish(false)))
			.addButton((button) => button
				.setButtonText("Delete notes")
				.setWarning()
				.onClick(() => this.finish(true)));
	}

	onClose(): void {
		this.contentEl.empty();
		this.finish(false);
	}

	private finish(confirmed: boolean): void {
		if (this.resolved) return;
		this.resolved = true;
		this.resolve(confirmed);
		this.close();
	}
}

function confirmDelete(app: App, candidates: AnkiNoteInfo[]): Promise<boolean> {
	return new Promise((resolve) => {
		new DeleteConfirmationModal(app, candidates, resolve).open();
	});
}

function renderDeletePreview(note: AnkiNoteInfo): HTMLElement {
	const item = document.createElement("article");
	item.addClass("oas-delete-preview-item");

	const title = item.createDiv({cls: "oas-delete-preview-title"});
	title.createEl("span", {text: `${note.modelName} · ${note.noteId}`});

	const uuid = getManagedUuid(note);
	const path = extractPathFromTags(note.tags);
	const metadata = item.createDiv({cls: "oas-delete-preview-meta"});
	metadata.createEl("span", {text: `UUID: ${uuid ?? "missing"}`});
	metadata.createEl("span", {text: `Path: ${path ?? "missing"}`});

	const fieldPreview = item.createDiv({cls: "oas-delete-preview-fields"});
	for (const line of summarizeFields(note)) {
		fieldPreview.createDiv({text: line});
	}

	return item;
}

function summarizeFields(note: AnkiNoteInfo): string[] {
	const orderedFields = Object.entries(note.fields)
		.sort((left, right) => left[1].order - right[1].order)
		.map(([name, field]) => `${name}: ${summarizeText(field.value)}`)
		.filter((line) => line.trim().length > 0);

	return orderedFields.length > 0 ? orderedFields : ["No field preview available."];
}

function summarizeText(value: string): string {
	const normalized = decodeBasicHtml(value)
		.replace(/<[^>]*>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	return normalized.length > 180 ? `${normalized.slice(0, 180)}...` : normalized;
}

function decodeBasicHtml(value: string): string {
	return value
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&amp;/g, "&")
		.replace(/&quot;/g, "\"")
		.replace(/&#039;/g, "'");
}

export function formatSummary(summary: SyncSummary): string {
	return [
		`${summary.cards} card(s)`,
		`${summary.created} created`,
		`${summary.updated} updated`,
		summary.modelChanged > 0 ? `${summary.modelChanged} model changed` : null,
		summary.deleted > 0 ? `${summary.deleted} deleted` : null,
		summary.filesChanged > 0 ? `${summary.filesChanged} file(s) updated` : null,
	].filter((part): part is string => part !== null).join(", ");
}

function emptySummary(): SyncSummary {
	return {
		scannedFiles: 0,
		cards: 0,
		created: 0,
		updated: 0,
		modelChanged: 0,
		deleted: 0,
		pendingDelete: 0,
		filesChanged: 0,
	};
}
