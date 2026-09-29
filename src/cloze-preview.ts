import {scanClozes} from "./cloze-scan";

export function prepareClozePreview(source: string): string {
	const mathTokens: string[] = [];
	let tokenized = normalizeMathDelimiters(source);

	tokenized = tokenized.replace(/\$\$([\s\S]*?)\$\$/g, (_match, formula: string) => {
		return pushMathToken(mathTokens, `$$${replaceLatexClozes(formula)}$$`);
	});

	tokenized = tokenized.replace(/\$(?!\s)([^$\n]*?\S)\$(?!\d)/g, (_match, formula: string) => {
		return pushMathToken(mathTokens, `$${replaceLatexClozes(formula)}$`);
	});

	tokenized = replaceAnkiClozes(tokenized, (answer) => {
		return `<span class="oas-cloze" title="${escapeAttribute(answer)}">[...]</span>`;
	});

	return tokenized.replace(/%%OAS_MATH_(\d+)%%/g, (_match, index: string) => {
		return mathTokens[Number(index)] ?? "";
	});
}

function pushMathToken(tokens: string[], renderedMath: string): string {
	tokens.push(renderedMath);
	return `%%OAS_MATH_${tokens.length - 1}%%`;
}

function normalizeMathDelimiters(source: string): string {
	return source
		.replace(/\\\[([\s\S]*?)\\\]/g, (_match, formula: string) => `$$${formula}$$`)
		.replace(/\\\(([\s\S]*?)\\\)/g, (_match, formula: string) => `$${formula}$`);
}

function replaceLatexClozes(formula: string): string {
	return replaceAnkiClozes(formula, () => "\\text{[...]}");
}

function replaceAnkiClozes(source: string, replacer: (answer: string) => string): string {
	let result = "";
	let readFrom = 0;

	scanClozes(source, ({start, answerStart, end}) => {
		const answer = stripClozeHint(source.slice(answerStart, end));
		result += source.slice(readFrom, start) + replacer(answer);
		readFrom = end + 2;
	});

	return result + source.slice(readFrom);
}

function stripClozeHint(answer: string): string {
	const hintIndex = answer.indexOf("::");
	return hintIndex >= 0 ? answer.slice(0, hintIndex) : answer;
}

function escapeAttribute(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}
