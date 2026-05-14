import {requestUrl} from "obsidian";
import {MANAGED_TAG, SUPPORTED_MODELS, TEMPLATE_SETUP_HINT} from "./constants";
import {prepareFieldsForAnki} from "./field-encoding";
import {AnkiFields, ParsedCard} from "./parser";
import {extractUuidFromTags, makeUuidTag} from "./tags";

export interface AnkiNoteInfo {
	noteId: number;
	modelName: string;
	tags: string[];
	fields: Record<string, {value: string; order: number}>;
	cards: number[];
}

export interface AnkiUpsertResult {
	noteId: number;
	created: boolean;
	modelChanged: boolean;
}

interface AddNotePayload {
	deckName: string;
	modelName: string;
	fields: AnkiFields;
	tags: string[];
	options: {
		allowDuplicate: boolean;
	};
}

interface CanAddNoteResult {
	canAdd: boolean;
	error?: string;
}

export class AnkiConnectClient {
	constructor(private readonly url: string) {}

	async version(): Promise<number> {
		return this.invoke<number>("version");
	}

	async modelNames(): Promise<string[]> {
		return this.invoke<string[]>("modelNames");
	}

	async verifyModernModels(): Promise<void> {
		const modelNames = await this.modelNames();
		const missing = SUPPORTED_MODELS.filter((modelName) => !modelNames.includes(modelName));
		if (missing.length > 0) {
			throw new Error(`${TEMPLATE_SETUP_HINT}\nMissing: ${missing.join(", ")}`);
		}
	}

	async createDeck(deck: string): Promise<void> {
		await this.invoke("createDeck", {deck});
	}

	async findNotes(query: string): Promise<number[]> {
		return this.invoke<number[]>("findNotes", {query});
	}

	async notesInfo(notes: number[]): Promise<AnkiNoteInfo[]> {
		if (notes.length === 0) return [];
		return this.invoke<AnkiNoteInfo[]>("notesInfo", {notes});
	}

	async addNote(card: ParsedCard): Promise<number> {
		return this.invoke<number>("addNote", {
			note: this.toAddNotePayload(card),
		});
	}

	async updateNote(noteId: number, fields: AnkiFields, tags: string[]): Promise<void> {
		const escapedFields = prepareFieldsForAnki(fields);
		try {
			await this.invoke("updateNoteFields", {
				note: {
					id: noteId,
					fields: escapedFields,
				},
			});
			await this.invoke("updateNoteTags", {
				note: noteId,
				tags,
			});
		} catch (error) {
			if (!isUnsupportedAction(error)) throw error;
			await this.invoke("updateNote", {
				note: {
					id: noteId,
					fields: escapedFields,
					tags,
				},
			});
		}
	}

	async updateNoteModel(noteId: number, modelName: string, fields: AnkiFields, tags: string[]): Promise<void> {
		const escapedFields = prepareFieldsForAnki(fields);
		try {
			await this.invoke("updateNoteModel", {
				note: {
					id: noteId,
					modelName,
					fields: escapedFields,
					tags,
				},
			});
		} catch (error) {
			if (!isUnsupportedAction(error)) throw error;
			throw new Error(`Anki note ${noteId} uses a different model. Delete it manually or update AnkiConnect to use updateNoteModel.`);
		}
	}

	async validateCardsCanBeAdded(cards: ParsedCard[]): Promise<void> {
		if (cards.length === 0) return;
		const localFailures = cards.filter((card) => !card.modelName.startsWith("Cloze-Modern") && fieldsContainClozeSyntax(card.fields));
		if (localFailures.length > 0) {
			const details = localFailures.map((card) => {
				return `#${card.ordinal + 1} ${card.modelName}: Basic note types cannot contain Anki cloze syntax like {{c1::...}} (${previewField(card.fields)})`;
			});
			throw new Error(`Anki rejected ${localFailures.length} card(s). Nothing was synced.\n${details.join("\n")}`);
		}

		for (const deckName of new Set(cards.map((card) => card.deckName))) {
			await this.createDeck(deckName);
		}

		const notes = cards.map((card) => this.toAddNotePayload(card));
		let results: CanAddNoteResult[];
		try {
			results = await this.invoke<CanAddNoteResult[]>("canAddNotesWithErrorDetail", {notes});
		} catch (error) {
			if (!isUnsupportedAction(error)) throw error;
			const fallback = await this.invoke<boolean[]>("canAddNotes", {notes});
			results = fallback.map((canAdd) => ({canAdd, error: canAdd ? undefined : "cannot create note for unknown reason"}));
		}

		const failures = results
			.map((result, index) => ({result, card: cards[index]}))
			.filter((item): item is {result: CanAddNoteResult; card: ParsedCard} => item.card !== undefined && !item.result.canAdd);

		if (failures.length === 0) return;

		const details = failures.map(({result, card}) => {
			return `#${card.ordinal + 1} ${card.modelName}: ${result.error ?? "cannot create note"} (${previewField(card.fields)})`;
		});
		throw new Error(`Anki rejected ${failures.length} card(s). Nothing was synced.\n${details.join("\n")}`);
	}

	async changeDeck(cards: number[], deck: string): Promise<void> {
		if (cards.length === 0) return;
		await this.createDeck(deck);
		await this.invoke("changeDeck", {cards, deck});
	}

	async deleteNotes(notes: number[]): Promise<void> {
		if (notes.length === 0) return;
		await this.invoke("deleteNotes", {notes});
	}

	async upsertCard(card: ParsedCard): Promise<AnkiUpsertResult> {
		await this.createDeck(card.deckName);

		const noteIds = await this.findNotes(`tag:${MANAGED_TAG} tag:${makeUuidTag(card.uuid)}`);
		if (noteIds.length === 0) {
			const noteId = await this.addNote(card);
			return {noteId, created: true, modelChanged: false};
		}

		const noteId = noteIds[0];
		if (noteId === undefined) {
			const createdNoteId = await this.addNote(card);
			return {noteId: createdNoteId, created: true, modelChanged: false};
		}

		const [existing] = await this.notesInfo([noteId]);
		if (!existing) {
			const createdNoteId = await this.addNote(card);
			return {noteId: createdNoteId, created: true, modelChanged: false};
		}

		const modelChanged = existing.modelName !== card.modelName;
		if (modelChanged) {
			await this.updateNoteModel(noteId, card.modelName, card.fields, card.ankiTags);
		} else {
			await this.updateNote(noteId, card.fields, card.ankiTags);
		}

		const [updatedInfo] = await this.notesInfo([noteId]);
		await this.changeDeck(updatedInfo?.cards ?? existing.cards, card.deckName);
		return {noteId, created: false, modelChanged};
	}

	async getManagedNotes(): Promise<AnkiNoteInfo[]> {
		return this.notesInfo(await this.findNotes(`tag:${MANAGED_TAG}`));
	}

	async getManagedNotesForPathTag(pathTag: string): Promise<AnkiNoteInfo[]> {
		return this.notesInfo(await this.findNotes(`tag:${MANAGED_TAG} tag:${pathTag}`));
	}

	private toAddNotePayload(card: ParsedCard): AddNotePayload {
		return {
			deckName: card.deckName,
			modelName: card.modelName,
			fields: prepareFieldsForAnki(card.fields),
			tags: card.ankiTags,
			options: {
				allowDuplicate: true,
			},
		};
	}

	private async invoke<T = null>(action: string, params?: Record<string, unknown>): Promise<T> {
		let response;
		try {
			response = await requestUrl({
				url: this.url,
				method: "POST",
				contentType: "application/json",
				throw: false,
				body: JSON.stringify({
					action,
					version: 6,
					params: params ?? {},
				}),
			});
		} catch (error) {
			throw new Error(`Cannot connect to AnkiConnect at ${this.url}. Make sure Anki is running and AnkiConnect is installed. ${errorMessage(error)}`);
		}

		if (response.status >= 400) {
			throw new Error(`AnkiConnect ${action} failed with HTTP ${response.status}.`);
		}

		const payload = response.json as {result: T; error: string | null};
		if (payload.error) {
			throw new Error(payload.error);
		}

		return payload.result;
	}
}

export function getManagedUuid(note: AnkiNoteInfo): string | null {
	return extractUuidFromTags(note.tags);
}

function isUnsupportedAction(error: unknown): boolean {
	const message = errorMessage(error).toLowerCase();
	return message.includes("unsupported action") || message.includes("not found") || message.includes("unknown action");
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function previewField(fields: AnkiFields): string {
	const value = "Text" in fields ? fields.Text : fields.Front;
	return value.replace(/\s+/g, " ").slice(0, 80);
}

function fieldsContainClozeSyntax(fields: AnkiFields): boolean {
	const values = "Text" in fields ? [fields.Text, fields.Extra] : [fields.Front, fields.Back];
	return values.some((value) => /\{\{c\d+::/i.test(value));
}
