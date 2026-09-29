export function trimOuterBlankLines(value: string): string {
	return value.replace(/^\s*\n/g, "").replace(/\n\s*$/g, "").trim();
}

export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
