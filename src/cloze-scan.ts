export interface ClozeRange {
	start: number;
	answerStart: number;
	end: number;
}

export function scanClozes(source: string, visit: (range: ClozeRange) => void): void {
	const opener = /\{\{c\d+::/g;
	let match: RegExpExecArray | null;

	while ((match = opener.exec(source)) !== null) {
		const answerStart = opener.lastIndex;
		const end = findClozeEnd(source, answerStart);
		if (end === -1) continue;

		visit({start: match.index, answerStart, end});
		opener.lastIndex = end + 2;
	}
}

export function findClozeEnd(source: string, answerStart: number): number {
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
