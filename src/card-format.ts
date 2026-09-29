import {findCardsSection} from "./parser";
import {trimOuterBlankLines} from "./utils";

export type QuickCardKind =
	| "cloze"
	| "cloze-typing"
	| "basic"
	| "basic-reversed"
	| "basic-typing";

export interface QuickCardDraft {
	kind: QuickCardKind;
	front: string;
	back: string;
	tags: string;
	syncAfterInsert: boolean;
}

export interface ClozeWrapResult {
	value: string;
	selectionStart: number;
	selectionEnd: number;
}

export function buildCardBlock(draft: QuickCardDraft): string {
	const lines: string[] = [];
	const typeLine = typeLineForKind(draft.kind);
	if (typeLine) lines.push(typeLine);

	if (draft.kind.startsWith("basic")) {
		lines.push("Front", draft.front.trim(), "Back", draft.back.trim());
	} else {
		lines.push(draft.front.trim());
		if (draft.back.trim().length > 0) {
			lines.push("Extra", draft.back.trim());
		}
	}

	if (draft.tags.trim().length > 0) {
		lines.push(`tags: ${draft.tags.trim()}`);
	}

	lines.push("uuid:", "path:");
	return trimOuterBlankLines(lines.join("\n")) + "\n";
}

export interface CardsInsertion {
	offset: number;
	text: string;
}

export function buildCardsInsertion(source: string, block: string): CardsInsertion {
	const section = findCardsSection(source);
	if (!section) {
		const prefix = source.trim().length === 0 ? "" : ensureTrailingBlankLines(source, 2);
		return {
			offset: source.length,
			text: `${prefix}# Cards\n${block}---\n`,
		};
	}

	const sectionContent = source.slice(section.contentStartOffset, section.endOffset);
	const leadingNewline = section.endOffset > 0 && source[section.endOffset - 1] !== "\n" ? "\n" : "";
	const separator = sectionContent.trim().length > 0 && !endsWithSeparator(sectionContent) ? "---\n" : "";

	return {
		offset: section.endOffset,
		text: `${leadingNewline}${separator}${block}---\n`,
	};
}

function endsWithSeparator(source: string): boolean {
	const lines = source.trimEnd().split("\n");
	return (lines[lines.length - 1] ?? "").trim() === "---";
}

function ensureTrailingBlankLines(source: string, count: number): string {
	const existing = source.match(/\n*$/)?.[0].length ?? 0;
	return "\n".repeat(Math.max(0, count - existing));
}

export function wrapNextCloze(value: string, selectionStart: number, selectionEnd: number): ClozeWrapResult {
	const start = clamp(selectionStart, 0, value.length);
	const end = clamp(selectionEnd, start, value.length);
	const clozeNumber = nextClozeNumber(value);
	const opener = `{{c${clozeNumber}::`;
	const selectedText = value.slice(start, end) || "answer";
	const wrapped = `${opener}${selectedText}}}`;
	const nextValue = value.slice(0, start) + wrapped + value.slice(end);
	const nextSelectionStart = start + opener.length;
	const nextSelectionEnd = nextSelectionStart + selectedText.length;

	return {
		value: nextValue,
		selectionStart: nextSelectionStart,
		selectionEnd: nextSelectionEnd,
	};
}

function typeLineForKind(kind: QuickCardKind): string | null {
	if (kind === "cloze-typing") return "type: Cloze-Modern-Typing";
	if (kind === "basic-reversed") return "type: Basic-Modern-Reversed";
	if (kind === "basic-typing") return "type: Basic-Modern-Typing";
	return null;
}

function nextClozeNumber(value: string): number {
	const pattern = /\{\{c(\d+)::/g;
	let next = 1;
	let match: RegExpExecArray | null;

	while ((match = pattern.exec(value)) !== null) {
		const number = Number(match[1]);
		if (Number.isFinite(number)) next = Math.max(next, number + 1);
	}

	return next;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}
