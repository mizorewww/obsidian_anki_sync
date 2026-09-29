import assert from "node:assert/strict";
import {describe, it} from "node:test";
import {buildCardBlock, buildCardsInsertion, wrapNextCloze} from "../src/card-format";
import {prepareClozePreview} from "../src/cloze-preview";
import {MANAGED_TAG} from "../src/constants";
import {prepareFieldsForAnki} from "../src/field-encoding";
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

describe("Anki field encoding", () => {
	it("encodes braces inside cloze answers without changing source fields", () => {
		const fields = {
			Text: "$$ {{c1::\\frac{\\text{A}}{\\text{B}}}} $$",
			Extra: "$$ \\frac{a}{b} $$",
		};

		assert.deepEqual(prepareFieldsForAnki(fields), {
			Text: "$$ {{c1::\\frac&#123;\\text&#123;A&#125;&#125;&#123;\\text&#123;B&#125;&#125;}} $$",
			Extra: "$$ \\frac{a}{b} $$",
		});
	});

	it("escapes HTML while keeping cloze delimiters readable to Anki", () => {
		assert.deepEqual(prepareFieldsForAnki({
			Text: "{{c1::<tag> {x} & y}}",
			Extra: "<extra>",
		}), {
			Text: "{{c1::&lt;tag&gt; &#123;x&#125; &amp; y}}",
			Extra: "&lt;extra&gt;",
		});
	});
});

describe("quick card builder", () => {
	it("creates human-editable blocks with blank identity placeholders", () => {
		const block = buildCardBlock({
			kind: "basic-reversed",
			front: "What is P/E?",
			back: "Price divided by earnings.",
			tags: "finance valuation",
			syncAfterInsert: false,
		});

		assert.equal(block, [
			"type: Basic-Modern-Reversed",
			"Front",
			"What is P/E?",
			"Back",
			"Price divided by earnings.",
			"tags: finance valuation",
			"uuid:",
			"path:",
			"",
		].join("\n"));
	});

	it("wraps selected text as the next cloze deletion", () => {
		assert.deepEqual(wrapNextCloze("A {{c1::B}} C D", 14, 15), {
			value: "A {{c1::B}} C {{c2::D}}",
			selectionStart: 20,
			selectionEnd: 21,
		});
	});

	it("inserts an editable cloze placeholder when nothing is selected", () => {
		assert.deepEqual(wrapNextCloze("A B", 1, 1), {
			value: "A{{c1::answer}} B",
			selectionStart: 7,
			selectionEnd: 13,
		});
	});
});

describe("quick card insertion", () => {
	const clozeBlock = buildCardBlock({
		kind: "cloze",
		front: "A {{c1::B}}",
		back: "",
		tags: "",
		syncAfterInsert: false,
	});

	it("appends a new cards section at the end of a note without one", () => {
		const source = "# Note\n\nBody text.\n";
		assert.deepEqual(buildCardsInsertion(source, clozeBlock), {
			offset: source.length,
			text: `\n# Cards\n${clozeBlock}---\n`,
		});
	});

	it("adds a separator before appending to an existing cards section", () => {
		const source = "# Note\n\n# Cards\nold card\n";
		assert.deepEqual(buildCardsInsertion(source, clozeBlock), {
			offset: source.length,
			text: `---\n${clozeBlock}---\n`,
		});
	});

	it("does not add a separator when the section already ends with one", () => {
		const source = "# Cards\nold card\n---\n";
		assert.deepEqual(buildCardsInsertion(source, clozeBlock), {
			offset: source.length,
			text: `${clozeBlock}---\n`,
		});
	});

	it("skips the separator for an empty cards section", () => {
		const source = "# Cards\n";
		assert.deepEqual(buildCardsInsertion(source, clozeBlock), {
			offset: source.length,
			text: `${clozeBlock}---\n`,
		});
	});
});

describe("cloze preview rendering", () => {
	it("masks clozes outside math with a placeholder span", () => {
		assert.equal(
			prepareClozePreview("答案是 {{c1::42}}。"),
			'答案是 <span class="oas-cloze" title="42">[...]</span>。',
		);
	});

	it("strips cloze hints from the placeholder title", () => {
		assert.equal(
			prepareClozePreview("{{c1::answer::hint}}"),
			'<span class="oas-cloze" title="answer">[...]</span>',
		);
	});

	it("masks clozes inside dollar math without leaking HTML", () => {
		assert.equal(
			prepareClozePreview("$${{c1::\\frac{1}{2}}}$$ 和 $x_{{c2::n}}$"),
			"$$\\text{[...]}$$ 和 $x_\\text{[...]}$",
		);
	});

	it("renders bracket math delimiters as display math", () => {
		assert.equal(
			prepareClozePreview("\\[\n{{c1::E[X]}} = \\sum_x x\n\\]"),
			"$$\n\\text{[...]} = \\sum_x x\n$$",
		);
	});

	it("renders parenthesis math delimiters as inline math", () => {
		assert.equal(
			prepareClozePreview("重复交易 \\(N\\) 次"),
			"重复交易 $N$ 次",
		);
	});

	it("masks clozes inside parenthesis math", () => {
		assert.equal(
			prepareClozePreview("即 \\({{c2::p_1x_1+\\cdots+p_kx_k}}\\)，即期望"),
			"即 $\\text{[...]}$，即期望",
		);
	});

	it("escapes HTML special characters in placeholder titles", () => {
		assert.equal(
			prepareClozePreview('{{c1::a <b> & "c"}}'),
			'<span class="oas-cloze" title="a &lt;b&gt; &amp; &quot;c&quot;">[...]</span>',
		);
	});
});

describe("cards section boundaries", () => {
	it("ends the cards section at the next heading of the same level", () => {
		const source = `# Cards
## 真正的卡片
答案是 {{c1::42}}。
---
# References
这段文字不是卡片，也不应被改写。
`;
		const parsed = parseCardsDocument(source, "p.md", {ensureIdentities: true, rootDeckName: "Obsidian"});

		assert.equal(parsed.cards.length, 1);
		assert.equal(parsed.cards[0]?.modelName, "Cloze-Modern");
		assert.match(parsed.updatedSource, /# References\n这段文字不是卡片，也不应被改写。\n?$/);
		assert.ok(!parsed.updatedSource.includes("这段文字不是卡片，也不应被改写。\nuuid:"));
	});

	it("keeps subheadings inside cards when the cards heading is a level up", () => {
		const source = `# Cards
## 卡片内的小标题
{{c1::内容}}
---
`;
		const parsed = parseCardsDocument(source, "p.md", {ensureIdentities: false, rootDeckName: "Obsidian"});
		assert.equal(parsed.cards.length, 1);
		const fields = parsed.cards[0]?.fields;
		assert.ok(fields && "Text" in fields);
		assert.match(fields.Text, /## 卡片内的小标题/);
	});

	it("ignores a cards heading inside a code fence", () => {
		const source = `# 说明文档

\`\`\`markdown
# Cards
示例内容
\`\`\`
`;
		const parsed = parseCardsDocument(source, "p.md", {ensureIdentities: false, rootDeckName: "Obsidian"});
		assert.equal(parsed.cards.length, 0);
		assert.equal(parsed.cardsSection, null);
	});

	it("does not split a card on a separator inside a code fence", () => {
		const source = `# Cards
Front
## 代码示例
\`\`\`yaml
---
key: value
\`\`\`
Back
答案
---
`;
		const parsed = parseCardsDocument(source, "p.md", {ensureIdentities: false, rootDeckName: "Obsidian"});
		assert.equal(parsed.cards.length, 1);
		const fields = parsed.cards[0]?.fields;
		assert.ok(fields && "Front" in fields && fields.Front.includes("---"));
	});

	it("keeps metadata-looking lines that appear inside code fences", () => {
		const source = `# Cards
Front
## 配置示例
\`\`\`yaml
tags: demo
\`\`\`
Back
答案
---
`;
		const parsed = parseCardsDocument(source, "p.md", {ensureIdentities: false, rootDeckName: "Obsidian"});
		assert.equal(parsed.cards.length, 1);
		const card = parsed.cards[0];
		assert.ok(card && "Front" in card.fields && card.fields.Front.includes("tags: demo"));
		assert.ok(!card.userTags.includes("demo"));
	});
});

describe("duplicate card identities", () => {
	it("assigns a fresh uuid to a duplicated block and keeps the first one", () => {
		const uuid = "11111111-1111-4111-8111-111111111111";
		const source = `# Cards
## 卡片甲
{{c1::A}}
uuid: ${uuid}
path: p.md
---
## 卡片乙（复制自甲）
{{c1::B}}
uuid: ${uuid}
path: p.md
---
`;
		const parsed = parseCardsDocument(source, "p.md", {ensureIdentities: true, rootDeckName: "Obsidian"});

		assert.equal(parsed.cards.length, 2);
		assert.equal(parsed.cards[0]?.uuid, uuid);
		assert.notEqual(parsed.cards[1]?.uuid, uuid);
		assert.match(parsed.cards[1]?.uuid ?? "", /^[0-9a-f-]{36}$/);
		assert.match(parsed.updatedSource, new RegExp(`## 卡片乙（复制自甲）\\n\\{\\{c1::B\\}\\}\\nuuid: ${parsed.cards[1]?.uuid}`));
	});
});

describe("quick card insertion edge cases", () => {
	it("adds a separator when the section ends with text that merely ends in dashes", () => {
		const block = buildCardBlock({kind: "cloze", front: "A {{c1::B}}", back: "", tags: "", syncAfterInsert: false});
		const source = "# Cards\nfinal score 9---\n";
		const insertion = buildCardsInsertion(source, block);
		assert.equal(insertion.text, `---\n${block}---\n`);
	});
});
