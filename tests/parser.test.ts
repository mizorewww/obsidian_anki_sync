import assert from "node:assert/strict";
import {describe, it} from "node:test";
import {MANAGED_TAG} from "../src/constants";
import {parseCardsDocument} from "../src/parser";
import {deckNameForPath, extractPathFromTags, makePathTag, makeUuidTag, sanitizeUserTag} from "../src/tags";

describe("parseCardsDocument", () => {
	it("parses cloze and basic cards and writes uuid/path", () => {
		const source = `---
tags:
  - math
  - python/tools
---
# Note
inline #review

# Cards
## 拉格朗日中值定理
在闭区间上{{c1::连续}}。
tag: theorem
---
Front
## 简答题
请简述 \`list\` 和 \`tuple\` 的区别。
Back
\`list\` 可变，\`tuple\` 不可变。
tags: python basic
---
`;

		const parsed = parseCardsDocument(source, "folder/page.md", {
			ensureIdentities: true,
			rootDeckName: "Obsidian",
		});

		assert.equal(parsed.cards.length, 2);
		assert.equal(parsed.changed, true);
		assert.match(parsed.updatedSource, /uuid: [0-9a-f-]{36}/);
		assert.match(parsed.updatedSource, /path: folder\/page\.md/);

		const cloze = parsed.cards[0];
		assert.ok(cloze);
		assert.equal(cloze.modelName, "Cloze-Modern");
		assert.deepEqual(cloze.fields, {Text: "## 拉格朗日中值定理\n在闭区间上{{c1::连续}}。", Extra: ""});
		assert.equal(cloze.deckName, "Obsidian::folder::page.md");
		assert.ok(cloze.ankiTags.includes(MANAGED_TAG));
		assert.ok(cloze.ankiTags.includes(makeUuidTag(cloze.uuid)));
		assert.ok(cloze.ankiTags.includes(makePathTag("folder/page.md")));
		assert.ok(cloze.ankiTags.includes("math"));
		assert.ok(cloze.ankiTags.includes("python::tools"));
		assert.ok(cloze.ankiTags.includes("review"));
		assert.ok(cloze.ankiTags.includes("theorem"));

		const basic = parsed.cards[1];
		assert.ok(basic);
		assert.equal(basic.modelName, "Basic-Modern");
		assert.deepEqual(basic.fields, {
			Front: "## 简答题\n请简述 `list` 和 `tuple` 的区别。",
			Back: "`list` 可变，`tuple` 不可变。",
		});
		assert.ok(basic.ankiTags.includes("basic"));
	});

	it("honors explicit type aliases and preserves existing identity", () => {
		const source = `# Cards
type: basic-reversed
Front
A
Back
B
uuid: 11111111-1111-4111-8111-111111111111
path: old/path.md
---
`;

		const parsed = parseCardsDocument(source, "new/path.md", {
			ensureIdentities: true,
			rootDeckName: "Deck",
		});

		assert.equal(parsed.cards.length, 1);
		assert.equal(parsed.cards[0]?.uuid, "11111111-1111-4111-8111-111111111111");
		assert.equal(parsed.cards[0]?.modelName, "Basic-Modern-Reversed");
		assert.match(parsed.updatedSource, /path: new\/path\.md/);
		assert.doesNotMatch(parsed.updatedSource, /old\/path\.md/);
	});

	it("treats blank identity lines as missing identity", () => {
		const source = `# Cards
## Blank identity
{{c1::generated}}
uuid:
path:
---
`;

		const parsed = parseCardsDocument(source, "moved/page.md", {
			ensureIdentities: true,
			rootDeckName: "Obsidian",
		});

		assert.equal(parsed.cards.length, 1);
		assert.match(parsed.cards[0]?.uuid ?? "", /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
		assert.match(parsed.updatedSource, /uuid: [0-9a-f-]{36}/);
		assert.match(parsed.updatedSource, /path: moved\/page\.md/);
		assert.doesNotMatch(parsed.updatedSource, /uuid:\s*\npath:/);
	});

	it("encodes path tags reversibly", () => {
		const tag = makePathTag("目录/页面 name.md");
		assert.equal(extractPathFromTags([tag]), "目录/页面 name.md");
	});
});

describe("tag and deck helpers", () => {
	it("sanitizes Anki tags and mirrors paths into deck names", () => {
		assert.equal(sanitizeUserTag("#python/tools"), "python::tools");
		assert.equal(sanitizeUserTag(" spaced tag "), "spaced_tag");
		assert.equal(deckNameForPath("Obsidian", "a/b.md"), "Obsidian::a::b.md");
	});
});
