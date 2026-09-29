import {scanClozes} from "./cloze-scan";
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
	let result = "";
	let cursor = 0;

	scanClozes(value, ({answerStart, end}) => {
		result += value.slice(cursor, answerStart);
		result += value.slice(answerStart, end).replace(/[{}]/g, (brace) => brace === "{" ? "&#123;" : "&#125;");
		result += "}}";
		cursor = end + 2;
	});

	return result + value.slice(cursor);
}
