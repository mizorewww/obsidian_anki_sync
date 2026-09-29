import {DEFAULT_ROOT_DECK, PATH_TAG_PREFIX, UUID_TAG_PREFIX} from "./constants";

export function encodeBase64Url(value: string): string {
	const bytes = new TextEncoder().encode(value);
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}

	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/g, "");
}

export function decodeBase64Url(value: string): string | null {
	try {
		const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
		const binary = atob(padded);
		const bytes = new Uint8Array(binary.length);
		for (let index = 0; index < binary.length; index += 1) {
			bytes[index] = binary.charCodeAt(index);
		}
		return new TextDecoder().decode(bytes);
	} catch {
		return null;
	}
}

export function makeUuidTag(uuid: string): string {
	return `${UUID_TAG_PREFIX}${uuid.toLowerCase()}`;
}

export function extractUuidFromTags(tags: string[]): string | null {
	const uuidTag = tags.find((tag) => tag.startsWith(UUID_TAG_PREFIX));
	return uuidTag ? uuidTag.slice(UUID_TAG_PREFIX.length) : null;
}

export function makePathTag(path: string): string {
	return `${PATH_TAG_PREFIX}${encodeBase64Url(path)}`;
}

export function extractPathFromTags(tags: string[]): string | null {
	const pathTag = tags.find((tag) => tag.startsWith(PATH_TAG_PREFIX));
	return pathTag ? decodeBase64Url(pathTag.slice(PATH_TAG_PREFIX.length)) : null;
}

export function sanitizeUserTag(tag: string): string | null {
	const cleaned = tag
		.trim()
		.replace(/^#+/, "")
		.replace(/\//g, "::")
		.replace(/[\s,]+/g, "_")
		.replace(/[^\p{L}\p{N}_:\-.]+/gu, "_")
		.replace(/^_+|_+$/g, "");

	return cleaned.length > 0 ? cleaned : null;
}

export function uniqueTags(tags: string[]): string[] {
	return Array.from(new Set(tags.filter((tag) => tag.length > 0))).sort((left, right) => left.localeCompare(right));
}

export function deckNameForPath(rootDeckName: string, path: string): string {
	const root = sanitizeDeckSegment(rootDeckName) || DEFAULT_ROOT_DECK;
	const segments = path.split("/").map(sanitizeDeckSegment).filter((segment) => segment.length > 0);
	return [root, ...segments].join("::");
}

function sanitizeDeckSegment(segment: string): string {
	return segment.trim().replace(/::/g, " - ").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ");
}
