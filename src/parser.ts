import {DEFAULT_ROOT_DECK, MANAGED_TAG, MODEL_ALIASES, SupportedModelName, SUPPORTED_MODELS} from "./constants";
import {deckNameForPath, makePathTag, makeUuidTag, sanitizeUserTag, uniqueTags} from "./tags";
import {trimOuterBlankLines} from "./utils";

export interface ParsedCardsDocument {
	cards: ParsedCard[];
	cardsSection: CardsSection | null;
	source: string;
	updatedSource: string;
	changed: boolean;
	pageTags: string[];
}

export interface CardsSection {
	headingLine: number;
	startOffset: number;
	contentStartOffset: number;
	endOffset: number;
	headingText: string;
}

export interface ParsedCard {
	uuid: string;
	path: string;
	ordinal: number;
	modelName: SupportedModelName;
	fields: AnkiFields;
	userTags: string[];
	ankiTags: string[];
	deckName: string;
	block: string;
	updatedBlock: string;
}

export type AnkiFields =
	| {Text: string; Extra: string}
	| {Front: string; Back: string};

interface ParseOptions {
	ensureIdentities: boolean;
	rootDeckName: string;
	path: string;
	usedUuids?: Set<string>;
}

interface BlockMeta {
	type: string | null;
	uuid: string | null;
	path: string | null;
	tags: string[];
}

const CARDS_HEADING = /^(#{1,6})\s+Cards\s*$/i;
const HEADING_LINE = /^(#{1,6})\s/;
const BLOCK_SEPARATOR = /^\s*---\s*$/;
const META_LINE = /^\s*(type|tag|tags|uuid|path)\s*:\s*(.*?)\s*$/i;
const FENCE_LINE = /^\s*(```|~~~)/;
const CLOZE_PATTERN = /\{\{c\d+::[\s\S]*?\}\}/i;
const FRONT_MARKER = /^\s*Front\s*$/i;
const BACK_MARKER = /^\s*Back\s*$/i;

export function parseCardsDocument(source: string, path: string, options?: Partial<ParseOptions>): ParsedCardsDocument {
	const rootDeckName = options?.rootDeckName ?? DEFAULT_ROOT_DECK;
	const ensureIdentities = options?.ensureIdentities ?? false;
	const pageTags = extractPageTags(source);
	const cardsSection = findCardsSection(source);

	if (!cardsSection) {
		return {
			cards: [],
			cardsSection: null,
			source,
			updatedSource: source,
			changed: false,
			pageTags,
		};
	}

	const sectionContent = source.slice(cardsSection.contentStartOffset, cardsSection.endOffset);
	const blocks = splitCardBlocks(sectionContent);
	const cards: ParsedCard[] = [];
	const usedUuids = new Set<string>();
	let changed = false;
	let rebuiltSection = "";

	for (let index = 0; index < blocks.length; index += 1) {
		const split = blocks[index];
		if (!split) continue;

		if (!hasCardContent(split.block)) {
			rebuiltSection += split.block + split.separator;
			continue;
		}

		const parsed = parseCardBlock(split.block, {
			ensureIdentities,
			rootDeckName,
			path,
			usedUuids,
		}, pageTags, cards.length);

		cards.push(parsed.card);
		rebuiltSection += parsed.card.updatedBlock + split.separator;
		changed = changed || parsed.changed;
	}

	const updatedSource = changed
		? source.slice(0, cardsSection.contentStartOffset) + rebuiltSection + source.slice(cardsSection.endOffset)
		: source;

	return {
		cards,
		cardsSection,
		source,
		updatedSource,
		changed,
		pageTags,
	};
}

export function findCardsSection(source: string): CardsSection | null {
	const lines = source.split(/\n/);
	let offset = 0;
	let inFence = false;

	for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
		const rawLine = lines[lineNumber] ?? "";
		const line = rawLine.replace(/\r$/, "");
		const lineStart = offset;
		offset += rawLine.length + 1;

		if (FENCE_LINE.test(line)) {
			inFence = !inFence;
			continue;
		}
		if (inFence) continue;

		const headingMatch = line.match(CARDS_HEADING);
		if (!headingMatch) continue;

		const headingLevel = headingMatch[1]?.length ?? 1;
		const lineEnd = lineStart + rawLine.length;
		const contentStartOffset = lineEnd + (lineEnd < source.length && source[lineEnd] === "\n" ? 1 : 0);
		return {
			headingLine: lineNumber,
			startOffset: lineStart,
			contentStartOffset,
			endOffset: findSectionEndOffset(source, lines, lineNumber + 1, headingLevel, offset),
			headingText: line.trim(),
		};
	}

	return null;
}

function findSectionEndOffset(source: string, lines: string[], fromLine: number, headingLevel: number, fromOffset: number): number {
	let offset = fromOffset;
	let inFence = false;

	for (let lineNumber = fromLine; lineNumber < lines.length; lineNumber += 1) {
		const rawLine = lines[lineNumber] ?? "";
		const line = rawLine.replace(/\r$/, "");

		if (FENCE_LINE.test(line)) {
			inFence = !inFence;
		} else if (!inFence) {
			const headingMatch = line.match(HEADING_LINE);
			const level = headingMatch?.[1]?.length;
			if (level !== undefined && level <= headingLevel) {
				return offset;
			}
		}

		offset += rawLine.length + 1;
	}

	return source.length;
}

export function extractPageTags(source: string): string[] {
	const tags = new Set<string>();

	for (const tag of extractFrontmatterTags(source)) {
		tags.add(tag);
	}

	const inlineTagPattern = /(^|[\s([>])#([\p{L}\p{N}_/-]+(?:\/[\p{L}\p{N}_/-]+)*)/gu;
	let match: RegExpExecArray | null;
	while ((match = inlineTagPattern.exec(stripFrontmatter(source))) !== null) {
		const value = match[2];
		if (value) tags.add(value);
	}

	return uniqueTags(Array.from(tags).map((tag) => sanitizeUserTag(tag)).filter((tag): tag is string => tag !== null));
}

export function normalizeModelName(value: string | null): SupportedModelName | null {
	if (!value) return null;
	const trimmed = value.trim();
	const direct = SUPPORTED_MODELS.find((modelName) => modelName.toLowerCase() === trimmed.toLowerCase());
	if (direct) return direct;
	return MODEL_ALIASES[trimmed.toLowerCase()] ?? null;
}

function parseCardBlock(block: string, options: ParseOptions, pageTags: string[], ordinal: number): {card: ParsedCard; changed: boolean} {
	const meta = extractBlockMeta(block);
	let uuid = normalizeUuid(meta.uuid) ?? createUuid();
	if (options.usedUuids?.has(uuid)) {
		uuid = createUuid();
	}
	options.usedUuids?.add(uuid);
	const modelName = chooseModelName(block, meta.type);
	const fields = parseFields(block, modelName);
	const mergedUserTags = uniqueTags([...pageTags, ...meta.tags].map((tag) => sanitizeUserTag(tag)).filter((tag): tag is string => tag !== null));
	const ankiTags = uniqueTags([
		MANAGED_TAG,
		makeUuidTag(uuid),
		makePathTag(options.path),
		...mergedUserTags,
	]);
	const updatedBlock = options.ensureIdentities ? ensureIdentityLines(block, uuid, options.path) : block;
	const deckName = deckNameForPath(options.rootDeckName, options.path);

	return {
		card: {
			uuid,
			path: options.path,
			ordinal,
			modelName,
			fields,
			userTags: mergedUserTags,
			ankiTags,
			deckName,
			block,
			updatedBlock,
		},
		changed: options.ensureIdentities && updatedBlock !== block,
	};
}

function chooseModelName(block: string, explicitType: string | null): SupportedModelName {
	const explicit = normalizeModelName(explicitType);
	if (explicit) return explicit;
	if (CLOZE_PATTERN.test(block)) return "Cloze-Modern";
	return "Basic-Modern";
}

function parseFields(block: string, modelName: SupportedModelName): AnkiFields {
	const contentLines = contentLinesOf(block);

	if (modelName.startsWith("Cloze-Modern")) {
		const extraIndex = contentLines.findIndex((line) => /^\s*Extra\s*$/i.test(line));
		if (extraIndex >= 0) {
			return {
				Text: trimOuterBlankLines(contentLines.slice(0, extraIndex).join("\n")),
				Extra: trimOuterBlankLines(contentLines.slice(extraIndex + 1).join("\n")),
			};
		}
		return {
			Text: trimOuterBlankLines(contentLines.join("\n")),
			Extra: "",
		};
	}

	const frontIndex = contentLines.findIndex((line) => FRONT_MARKER.test(line));
	const backIndex = contentLines.findIndex((line) => BACK_MARKER.test(line));

	if (frontIndex >= 0 && backIndex > frontIndex) {
		return {
			Front: trimOuterBlankLines(contentLines.slice(frontIndex + 1, backIndex).join("\n")),
			Back: trimOuterBlankLines(contentLines.slice(backIndex + 1).join("\n")),
		};
	}

	return {
		Front: trimOuterBlankLines(contentLines.join("\n")),
		Back: "",
	};
}

function extractBlockMeta(block: string): BlockMeta {
	const meta: BlockMeta = {
		type: null,
		uuid: null,
		path: null,
		tags: [],
	};

	let inFence = false;
	for (const line of block.split(/\n/)) {
		if (FENCE_LINE.test(line.replace(/\r$/, ""))) {
			inFence = !inFence;
			continue;
		}
		if (inFence) continue;

		const match = line.match(META_LINE);
		if (!match) continue;

		const key = match[1]?.toLowerCase();
		const value = match[2]?.trim() ?? "";
		if (key === "type") meta.type = value;
		if (key === "uuid") meta.uuid = value;
		if (key === "path") meta.path = value;
		if (key === "tag" || key === "tags") meta.tags.push(...splitTags(value));
	}

	return meta;
}

function ensureIdentityLines(block: string, uuid: string, path: string): string {
	const newline = block.endsWith("\n") ? "\n" : "";
	const lines: string[] = [];
	let inFence = false;

	for (const line of block.replace(/\n$/, "").split(/\n/)) {
		if (FENCE_LINE.test(line.replace(/\r$/, ""))) {
			inFence = !inFence;
			lines.push(line);
			continue;
		}

		if (!inFence) {
			const match = line.match(META_LINE);
			if (match) {
				const key = match[1]?.toLowerCase();
				if (key === "uuid" || key === "path") continue;
			}
		}

		lines.push(line);
	}

	while (lines.length > 0 && (lines[lines.length - 1] ?? "").trim() === "") {
		lines.pop();
	}

	lines.push(`uuid: ${uuid}`, `path: ${path}`);
	return lines.join("\n") + newline;
}

function splitCardBlocks(sectionContent: string): Array<{block: string; separator: string}> {
	const lines = sectionContent.split(/(\n)/);
	const blocks: Array<{block: string; separator: string}> = [];
	let current = "";
	let inFence = false;

	for (let index = 0; index < lines.length; index += 2) {
		const line = lines[index] ?? "";
		const newline = lines[index + 1] ?? "";

		if (FENCE_LINE.test(line.replace(/\r$/, ""))) {
			inFence = !inFence;
		} else if (!inFence && BLOCK_SEPARATOR.test(line)) {
			blocks.push({block: current, separator: line + newline});
			current = "";
			continue;
		}

		current += line + newline;
	}

	if (current.length > 0) {
		blocks.push({block: current, separator: ""});
	}

	return blocks;
}

function hasCardContent(block: string): boolean {
	return contentLinesOf(block).some((line) => line.trim() !== "");
}

function contentLinesOf(block: string): string[] {
	const lines: string[] = [];
	let inFence = false;

	for (const line of block.split(/\n/)) {
		if (FENCE_LINE.test(line.replace(/\r$/, ""))) {
			inFence = !inFence;
			lines.push(line);
			continue;
		}
		if (!inFence && isMetadataLine(line)) continue;
		lines.push(line);
	}

	return lines;
}

function isMetadataLine(line: string): boolean {
	return META_LINE.test(line);
}

function splitTags(value: string): string[] {
	if (!value.trim()) return [];
	const bracketList = value.match(/^\[(.*)\]$/);
	const normalized = bracketList ? bracketList[1] ?? "" : value;
	return normalized
		.split(/[,\s]+/)
		.map((tag) => tag.trim().replace(/^["']|["']$/g, ""))
		.filter((tag) => tag.length > 0);
}

function extractFrontmatterTags(source: string): string[] {
	if (!source.startsWith("---")) return [];
	const end = source.indexOf("\n---", 3);
	if (end < 0) return [];
	const frontmatter = source.slice(3, end).split(/\n/);
	const tags: string[] = [];

	for (let index = 0; index < frontmatter.length; index += 1) {
		const line = frontmatter[index] ?? "";
		const inline = line.match(/^\s*tags\s*:\s*(.*?)\s*$/i);
		if (!inline) continue;

		const value = inline[1] ?? "";
		if (value.trim().startsWith("[")) {
			tags.push(...splitTags(value));
			continue;
		}

		if (value.trim().length > 0) {
			tags.push(...splitTags(value));
			continue;
		}

		for (let listIndex = index + 1; listIndex < frontmatter.length; listIndex += 1) {
			const listLine = frontmatter[listIndex] ?? "";
			const listItem = listLine.match(/^\s*-\s*(.*?)\s*$/);
			if (!listItem) break;
			tags.push(listItem[1] ?? "");
		}
	}

	return tags;
}

function stripFrontmatter(source: string): string {
	if (!source.startsWith("---")) return source;
	const end = source.indexOf("\n---", 3);
	return end >= 0 ? source.slice(end + 4) : source;
}

function createUuid(): string {
	if (typeof globalThis.crypto?.randomUUID === "function") {
		return globalThis.crypto.randomUUID();
	}

	return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
		const random = Math.floor(Math.random() * 16);
		const value = char === "x" ? random : (random & 0x3) | 0x8;
		return value.toString(16);
	});
}

function normalizeUuid(value: string | null): string | null {
	if (!value) return null;
	const normalized = value.trim().toLowerCase();
	if (normalized.length === 0) return null;
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)) {
		return null;
	}
	return normalized;
}

