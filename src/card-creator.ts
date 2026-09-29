import {
	App,
	ButtonComponent,
	Editor,
	Modal,
	Notice,
	Setting,
	TFile,
} from "obsidian";
import {buildCardBlock, buildCardsInsertion, QuickCardDraft, QuickCardKind, wrapNextCloze} from "./card-format";
import {errorMessage} from "./utils";

export interface QuickCardInsertResult {
	file: TFile;
	shouldSync: boolean;
}

export interface QuickCardModalOptions {
	allowSync: boolean;
	file: TFile | null;
	editor?: Editor;
	initialText?: string;
}

export class QuickCardModal extends Modal {
	private draft: QuickCardDraft = {
		kind: "cloze",
		front: "",
		back: "",
		tags: "",
		syncAfterInsert: false,
	};

	private formContainer: HTMLElement | null = null;
	private createButton: ButtonComponent | null = null;
	private primaryInput: HTMLTextAreaElement | null = null;

	constructor(
		app: App,
		private readonly onInsert: (result: QuickCardInsertResult) => void,
		private readonly onBeforeInsert?: (file: TFile) => void,
		private readonly options: QuickCardModalOptions = {allowSync: true, file: null},
	) {
		super(app);
		if (options.initialText?.trim()) {
			this.draft.front = options.initialText;
		}
	}

	onOpen(): void {
		const {contentEl} = this;
		contentEl.empty();
		this.modalEl.addClass("oas-card-modal");
		this.setTitle("Create Anki card");

		if (!this.options.file) {
			new Setting(contentEl)
				.setName("No target note")
				.setDesc("Open a Markdown note, then create the card from its tab or with this note active.");
		}

		new Setting(contentEl)
			.setName("Type")
			.setDesc("Use cloze for deletion cards, or basic for front/back cards.")
			.addDropdown((dropdown) => {
				dropdown
					.addOption("cloze", "Cloze")
					.addOption("cloze-typing", "Cloze typing")
					.addOption("basic", "Basic")
					.addOption("basic-reversed", "Basic reversed")
					.addOption("basic-typing", "Basic typing")
					.setValue(this.draft.kind)
					.onChange((value) => {
						this.draft.kind = value as QuickCardKind;
						this.renderFields();
						this.updateCreateButton();
					});
			});

		this.formContainer = contentEl.createDiv({cls: "oas-card-modal-fields"});
		this.renderFields();

		new Setting(contentEl)
			.setName("Tags")
			.setDesc("Optional card-local tags, separated by spaces or commas.")
			.addText((text) => {
				text
					.setPlaceholder("Math theorem")
					.setValue(this.draft.tags)
					.onChange((value) => {
						this.draft.tags = value;
					});
			});

		if (this.options.allowSync) {
			new Setting(contentEl)
				.setName("Sync after insert")
				.setDesc("Immediately sync the current page after creating the card.")
				.addToggle((toggle) => {
					toggle
						.setValue(this.draft.syncAfterInsert)
						.onChange((value) => {
							this.draft.syncAfterInsert = value;
						});
				});
		}

		new Setting(contentEl)
			.addButton((button) => button
				.setButtonText("Cancel")
				.onClick(() => this.close()))
			.addButton((button) => {
				this.createButton = button;
				button
					.setButtonText("Insert card")
					.setCta()
					.onClick(() => {
						void this.insertCard();
					});
			});
		this.updateCreateButton();

		this.scope.register(["Mod"], "Enter", () => {
			if (this.canInsert()) {
				void this.insertCard();
			}
			return false;
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private renderFields(): void {
		if (!this.formContainer) return;
		this.formContainer.empty();

		const isBasic = this.draft.kind.startsWith("basic");
		this.primaryInput = null;

		new Setting(this.formContainer)
			.setName(isBasic ? "Front" : "Text")
			.setDesc(isBasic ? "Question side. Markdown and LaTeX are supported." : "Write text normally, then select text and wrap it as cloze.")
			.addTextArea((text) => {
				this.primaryInput = text.inputEl;
				text
					.setPlaceholder(isBasic ? "What is ..." : "The derivative of {{c1::x^2}} is {{c2::2x}}.")
					.setValue(this.draft.front)
					.onChange((value) => {
						this.draft.front = value;
						this.updateCreateButton();
					});
				text.inputEl.rows = 7;
			});

		if (!isBasic) {
			new Setting(this.formContainer)
				.setName("Cloze helper")
				.setDesc("Select text above, then wrap it as the next cloze deletion.")
				.addButton((button) => {
					button
						.setButtonText("Wrap selection")
						.onClick(() => this.wrapPrimarySelectionAsCloze());
				});
		}

		new Setting(this.formContainer)
			.setName(isBasic ? "Back" : "Extra")
			.setDesc(isBasic ? "Answer side." : "Optional back-side notes.")
			.addTextArea((text) => {
				text
					.setPlaceholder(isBasic ? "Answer..." : "Optional explanation...")
					.setValue(this.draft.back)
					.onChange((value) => {
						this.draft.back = value;
					});
				text.inputEl.rows = 5;
			});
	}

	private canInsert(): boolean {
		return this.options.file !== null && this.draft.front.trim().length > 0;
	}

	private updateCreateButton(): void {
		this.createButton?.setDisabled(!this.canInsert());
	}

	private wrapPrimarySelectionAsCloze(): void {
		if (!this.primaryInput) return;

		const result = wrapNextCloze(
			this.primaryInput.value,
			this.primaryInput.selectionStart,
			this.primaryInput.selectionEnd,
		);

		this.draft.front = result.value;
		this.primaryInput.value = result.value;
		this.primaryInput.focus();
		this.primaryInput.setSelectionRange(result.selectionStart, result.selectionEnd);
		this.updateCreateButton();
	}

	private async insertCard(): Promise<void> {
		const file = this.options.file;
		if (!file) {
			new Notice("Open a Markdown note before creating an Anki card.");
			return;
		}

		try {
			const block = buildCardBlock(this.draft);
			this.onBeforeInsert?.(file);
			await insertCardBlock(this.app, file, this.options.editor ?? null, block);
		} catch (error) {
			new Notice(`Could not insert the Anki card: ${errorMessage(error)}`);
			return;
		}

		this.onInsert({file, shouldSync: this.options.allowSync && this.draft.syncAfterInsert});
		this.close();
	}
}

async function insertCardBlock(app: App, file: TFile, editor: Editor | null, block: string): Promise<void> {
	const source = await app.vault.read(file);
	const insertion = buildCardsInsertion(source, block);
	const updated = source.slice(0, insertion.offset) + insertion.text + source.slice(insertion.offset);
	await app.vault.modify(file, updated);

	if (editor) {
		const cursorOffset = insertion.offset + insertion.text.length;
		editor.setCursor(editor.offsetToPos(cursorOffset));
	}
}
