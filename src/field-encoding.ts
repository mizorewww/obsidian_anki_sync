import {AnkiFields} from "./parser";

export function prepareFieldsForAnki(fields: AnkiFields): AnkiFields {
	if ("Text" in fields) {
		return {
			Text: encodeClozeInnerBraces(escapeHtml(fields.Text)),
			Extra: escapeHtml(fields.Extra),
		};
	}

	return {
		Front: escapeHtml(fields.Front),
		Back: escapeHtml(fields.Back),
	};
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

function encodeClozeInnerBraces(value: string): string {
	const opener = /\{\{c\d+::/gi;
	let result = "";
	let cursor = 0;

	while (true) {
		const match = opener.exec(value);
		if (!match) break;

		const answerStart = opener.lastIndex;
		const closeStart = findBalancedClozeEnd(value, answerStart);
		if (closeStart < 0) continue;

		result += value.slice(cursor, answerStart);
		result += value.slice(answerStart, closeStart).replace(/[{}]/g, (brace) => brace === "{" ? "&#123;" : "&#125;");
		result += "}}";
		cursor = closeStart + 2;
		opener.lastIndex = cursor;
	}

	return result + value.slice(cursor);
}

function findBalancedClozeEnd(value: string, answerStart: number): number {
	let braceDepth = 0;

	for (let index = answerStart; index < value.length - 1; index += 1) {
		const char = value[index];
		if (char === "{") {
			braceDepth += 1;
			continue;
		}
		if (char !== "}") continue;
		if (braceDepth > 0) {
			braceDepth -= 1;
			continue;
		}
		if (value[index + 1] === "}") return index;
	}

	return -1;
}
