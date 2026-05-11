import {App, MarkdownPostProcessorContext, MarkdownRenderer, MarkdownRenderChild, Plugin} from "obsidian";
import {ParsedCard, parseCardsDocument} from "./parser";

export function registerCardPreview(plugin: Plugin, app: App): void {
	plugin.registerMarkdownPostProcessor(async (element, context) => {
		const heading = findCardsHeading(element);
		if (!heading || heading.dataset.oasPreviewProcessed === "true") return;

		const file = app.vault.getFileByPath(context.sourcePath);
		if (!file) return;

		const source = await app.vault.cachedRead(file);
		const parsed = parseCardsDocument(source, file.path, {
			ensureIdentities: false,
			rootDeckName: "Obsidian",
		});

		if (parsed.cards.length === 0) return;

		heading.dataset.oasPreviewProcessed = "true";
		const container = document.createElement("div");
		container.addClass("oas-card-preview-list");

		for (const card of parsed.cards) {
			container.appendChild(await renderCardPreview(app, card, context));
		}

		heading.insertAdjacentElement("afterend", container);
		hideOriginalCardSource(heading, container);
	});
}

async function renderCardPreview(app: App, card: ParsedCard, context: MarkdownPostProcessorContext): Promise<HTMLElement> {
	const preview = document.createElement("article");
	preview.addClass("oas-card-preview");
	preview.dataset.modelName = card.modelName;
	const renderChild = new MarkdownRenderChild(preview);
	context.addChild(renderChild);

	const header = document.createElement("div");
	header.addClass("oas-card-preview-header");
	header.createEl("span", {text: card.modelName});
	header.createEl("span", {text: card.uuid});
	preview.appendChild(header);

	if ("Text" in card.fields) {
		const content = preview.createDiv({cls: "oas-rendered-content"});
		await renderObsidianMarkdown(renderChild, app, content, prepareClozePreview(card.fields.Text), context.sourcePath);
	} else {
		preview.appendChild(await renderBasicSection(renderChild, app, context, "Front", card.fields.Front));
		preview.appendChild(await renderBasicSection(renderChild, app, context, "Back", card.fields.Back));
	}

	const footer = document.createElement("div");
	footer.addClass("oas-card-preview-tags");
	for (const tag of card.userTags) {
		footer.createEl("span", {text: tag});
	}
	if (footer.children.length > 0) preview.appendChild(footer);

	return preview;
}

async function renderBasicSection(renderChild: MarkdownRenderChild, app: App, context: MarkdownPostProcessorContext, label: string, markdown: string): Promise<HTMLElement> {
	const section = document.createElement("section");
	section.addClass("oas-basic-section");
	section.createEl("div", {cls: "oas-basic-section-label", text: label});
	const content = section.createDiv({cls: "oas-rendered-content"});
	await renderObsidianMarkdown(renderChild, app, content, prepareClozePreview(markdown), context.sourcePath);
	return section;
}

async function renderObsidianMarkdown(renderChild: MarkdownRenderChild, app: App, container: HTMLElement, markdown: string, sourcePath: string): Promise<void> {
	await MarkdownRenderer.render(app, markdown, container, sourcePath, renderChild);
}

function prepareClozePreview(source: string): string {
	let tokenized = source.replace(/\$\$([\s\S]*?)\$\$/g, (_match, formula: string) => {
		return `$$${replaceLatexClozes(formula)}$$`;
	});

	tokenized = tokenized.replace(/\$([^$\n]+?)\$/g, (_match, formula: string) => {
		return `$${replaceLatexClozes(formula)}$`;
	});

	return replaceAnkiClozes(tokenized, (answer) => {
		return `<span class="oas-cloze" title="${escapeAttribute(answer)}">[...]</span>`;
	});
}

function replaceLatexClozes(formula: string): string {
	return replaceAnkiClozes(formula, () => "\\text{[...]}");
}

function replaceAnkiClozes(source: string, replacer: (answer: string) => string): string {
	const opener = /\{\{c\d+::/g;
	let result = "";
	let readFrom = 0;
	let match: RegExpExecArray | null;

	while ((match = opener.exec(source)) !== null) {
		const start = match.index;
		const answerStart = opener.lastIndex;
		const end = findClozeEnd(source, answerStart);
		if (end === -1) continue;

		const answer = stripClozeHint(source.slice(answerStart, end));
		result += source.slice(readFrom, start) + replacer(answer);
		readFrom = end + 2;
		opener.lastIndex = readFrom;
	}

	return result + source.slice(readFrom);
}

function findClozeEnd(source: string, answerStart: number): number {
	let braceDepth = 0;

	for (let index = answerStart; index < source.length - 1; index += 1) {
		const char = source[index];
		if (char === "{") {
			braceDepth += 1;
			continue;
		}

		if (char !== "}") continue;

		if (braceDepth > 0) {
			braceDepth -= 1;
			continue;
		}

		if (source[index + 1] === "}") {
			return index;
		}
	}

	return -1;
}

function stripClozeHint(answer: string): string {
	const hintIndex = answer.indexOf("::");
	return hintIndex >= 0 ? answer.slice(0, hintIndex) : answer;
}

function findCardsHeading(element: HTMLElement): HTMLElement | null {
	const headings = Array.from(element.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6"));
	return headings.find((heading) => heading.textContent?.trim().toLowerCase() === "cards") ?? null;
}

function hideOriginalCardSource(heading: HTMLElement, previewContainer: HTMLElement): void {
	const headingLevel = Number(heading.tagName.slice(1));
	let sibling = previewContainer.nextElementSibling as HTMLElement | null;

	while (sibling) {
		const next = sibling.nextElementSibling as HTMLElement | null;
		if (isHeadingAtOrAbove(sibling, headingLevel)) break;
		sibling.addClass("oas-hidden-card-source");
		sibling = next;
	}
}

function isHeadingAtOrAbove(element: HTMLElement, headingLevel: number): boolean {
	if (!/^H[1-6]$/.test(element.tagName)) return false;
	return Number(element.tagName.slice(1)) <= headingLevel;
}

function escapeAttribute(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}
