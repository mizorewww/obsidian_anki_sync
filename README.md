# Obsidian Anki Sync

把 Obsidian 页面里的 `# Cards` 区域同步到 Anki。插件通过 AnkiConnect 写入 Anki，并使用 `/home/aac6fef/Developer/my_anki_template/` 里的 Modern 模板。

## 功能

- 从当前页面或全库 Markdown 中解析卡片并同步到 Anki。
- 提供 `Create Anki card` 命令和左侧按钮，用表单快速创建 Cloze/Basic 卡片。
- 每张卡片用 `uuid:` 作为稳定身份，用当前 Obsidian 文件路径作为来源。
- Anki 中只管理带 `obsidian_anki_sync` 标签的笔记，不碰其他 Anki 笔记。
- 自动创建 `Obsidian::<页面路径>` 层级牌组，例如 `Anki Sync Corner Cases.md` 会进入 `Obsidian::Anki Sync Corner Cases.md`。
- 阅读视图中把 `# Cards` 区域显示成圆角卡片预览。预览使用 Obsidian 自带 Markdown/LaTeX 渲染，插件只提供外观和 cloze 占位。
- 移动端可安装并渲染卡片预览，也可以创建卡片；AnkiConnect 同步入口只在桌面端启用。

## 前置条件

1. 安装 Anki Desktop。
2. 安装 AnkiConnect 插件。
3. 先同步 Modern Anki 模板：

```bash
python3 /home/aac6fef/Developer/my_anki_template/anki_connect.py
```

插件会检查这些 Anki note type 是否存在：

- `Cloze-Modern`
- `Cloze-Modern-Typing`
- `Basic-Modern`
- `Basic-Modern-Reversed`
- `Basic-Modern-Typing`

移动端不需要 Anki Desktop 或 AnkiConnect。移动端只负责阅读预览和编辑制卡，实际同步请回到桌面端执行。

## 开发和构建

```bash
npm install
npm run build
```

开发时可以用：

```bash
npm run dev
```

本仓库已经可以作为 Obsidian 插件目录使用。当前 vault 中的插件目录是一个 symlink：

```text
/home/aac6fef/Documents/Obsidian Vault/.obsidian/plugins/obsidian_anki_sync
```

如果重新构建了 `main.js`，在 Obsidian 里 reload app 或禁用再启用插件。

## 设置

- **Anki connect endpoint**：默认 `http://127.0.0.1:8765`。
- **Root deck**：默认 `Obsidian`。
- **Sync on save**：保存带 `# Cards` 的页面时自动同步当前页。
- **Confirm before deleting**：删除 Anki 中已不存在的托管卡片前先确认。

## 卡片书写格式

人类制卡时建议优先使用命令面板、左侧按钮或编辑器右键菜单里的 `Create Anki card`。选中一段文字再打开它，弹窗会自动带入选中文本；Cloze 模式下可以选中文本后点击 `Wrap selection`，插件会自动生成下一个 `{{cN::...}}`。按 `Cmd/Ctrl+Enter` 可以直接插入卡片。

卡片必须写在页面的 `# Cards` 标题下面。每张卡片之间用单独一行 `---` 分隔。卡片区域到下一个同级（或更高级）标题为止；其后的正文不会被当作卡片解析。代码围栏里的 `# Cards`、`---`、`tags:` 等行不会被误认为区域标题、分隔线或元数据。

```markdown
# Cards

## 拉格朗日中值定理

函数在闭区间上{{c1::连续}}，在开区间内{{c2::可导}}。

tag: math
uuid:
path:
---

Front

## 简答题

请简述 `list` 和 `tuple` 的区别。

Back

`list` 可变，`tuple` 不可变。

tag: python
uuid:
path:
---
```

新卡片建议把 `uuid:` 和 `path:` 留空，或者完全省略这两行。插件会自动补充或修正：

```markdown
uuid: <stable-card-uuid>
path: <vault-relative-note-path.md>
```

通常不要手写、编造或修改 `uuid:`。移动文件后，插件会保留 `uuid:`，更新 `path:`、Anki path tag 和 Anki 牌组，这样 Anki 复习历史不会丢。空的 `uuid:` 会被当成“需要生成新身份”。

## 支持的卡片类型

### Cloze

只要卡片内容里包含 Anki cloze 语法，插件默认使用 `Cloze-Modern`：

```markdown
## 导数定义

导数是函数在一点处的{{c1::瞬时变化率}}。

tag: calculus
uuid:
path:
---
```

可选 `Extra` 字段：

```markdown
type: cloze

## 欧拉公式

$${{c1::e^{i\pi}+1=0}}$$

Extra

这是一个复分析中的经典公式。

tag: math
uuid:
path:
---
```

### Basic

使用独立一行 `Front` 和 `Back`：

```markdown
Front

## Python tuple

`tuple` 的核心特征是什么？

Back

不可变、有序、可迭代。

tag: python
uuid:
path:
---
```

### 显式 type

可用完整模型名或短别名：

```markdown
type: basic-reversed
```

支持的短别名：

| type | Anki note type |
| --- | --- |
| `cloze` | `Cloze-Modern` |
| `cloze-type` | `Cloze-Modern-Typing` |
| `basic` | `Basic-Modern` |
| `basic-reversed` | `Basic-Modern-Reversed` |
| `basic-type` | `Basic-Modern-Typing` |

## 标签规则

同步到 Anki 的标签来自三处：

- 页面 properties/frontmatter 的 `tags`。
- 正文里的 inline tag，例如 `#review`。
- 卡片块里的 `tag:` 或 `tags:`。

卡片块示例：

```markdown
tag: python
tags: math/function theorem
```

Anki tag 会做安全转换：

- 开头的 `#` 会被去掉。
- `/` 会变成 `::`，例如 `math/analysis` -> `math::analysis`。
- 空格会变成 `_`。
- 插件还会自动添加 `obsidian_anki_sync`、UUID tag 和 path tag。

## 同步行为

### Sync current page to Anki

- 只解析当前页面。
- 补写缺失的 `uuid:` 和 `path:`。
- 新增或更新当前页对应的 Anki notes。
- 如果当前页里某个 UUID 删除了，会只清理这个页面路径下对应的托管 Anki note。

### Sync all pages to Anki

- 扫描 vault 中所有 Markdown。
- 建立所有托管 UUID 的目标集合。
- 删除 Anki 中带 `obsidian_anki_sync` 但源卡片已不存在的 notes。

同步前插件会预检所有待写入卡片。如果有一张卡片 Anki 不接受，整批不会写入，避免出现“前几张已经进 Anki，后面失败”的半同步状态。

## 重要限制和坑

### Basic 系列不能包含 cloze 语法

`Basic-Modern`、`Basic-Modern-Reversed`、`Basic-Modern-Typing` 的任何字段里都不要出现 Anki cloze 语法。

这包括：

- `Front`
- `Back`
- 代码块
- inline code
- 解释文字

也就是说，只要 Basic 字段里出现形如 `{{c1::...}}` 的字面量，Anki 就可能拒绝创建 note，并返回 `cannot create note for unknown reason`。

如果你只是想解释这种语法，请把它写成不被 Anki 识别的形式，例如：

```text
{{ c1::answer }}
```

### 字段写 Markdown，不写 HTML

卡片内容按 Markdown 写即可：

- 标题
- 列表
- 表格
- 引用块
- 代码块
- 行内和块级 LaTeX

插件写入 Anki 前会转义 `&`、`<`、`>`，避免 Anki 的 HTML 字段破坏 Markdown 原文。

### 分隔符必须独占一行

卡片分隔符必须是独占一行的：

```markdown
---
```

如果卡片内容里需要水平线，避免使用独占一行的 `---`，可以改用文字说明或 `***`。

### LaTeX 中的 cloze

Anki 的 cloze 解析会先于模板渲染执行。复杂 LaTeX 里常见的相邻 `}}` 原本会被 Anki 误判为 cloze 结束，例如：

```markdown
$${{c1::f'(\xi)=\frac{f(b)-f(a)}{b-a}}}$$
```

插件同步时会自动把 cloze 答案内部的 `{` / `}` 安全编码，避免这个截断问题，Obsidian 原文不需要改成实体。更推荐的制卡写法仍然是：在正文里 cloze 关键概念，公式保持完整展示。

```markdown
**市盈率**是公司的 {{c1::股价与每股收益的比率}}。

$$\text{P/E} = \frac{\text{Share Price}}{\text{Earnings per Share}}$$
```

如果确实要在公式里挖空，可以直接按 Markdown/LaTeX 原文写；插件会在写入 Anki 时处理花括号。为了复习体验更清楚，优先只挖符号名、数字或公式旁边的文字说明。

## 给 LLM 制卡的注意事项

如果让 LLM 给这个插件生成卡片，把下面规则直接贴给它。

### LLM 制卡规则

1. 只在 `# Cards` 标题下生成卡片。
2. 每张卡片之间用独占一行的 `---` 分隔。
3. 新卡片必须把 `uuid:` 和 `path:` 留空，或者完全省略；不要编造 UUID，不要猜路径。
4. 修改已有卡片时保留已有 `uuid:`，不要改；移动页面时让插件更新 `path:`。
5. Cloze 卡可以使用 `{{c1::答案}}`、`{{c2::答案}}`。
6. Basic、Basic-Reversed、Basic-Type 的 `Front` 和 `Back` 里绝对不要出现 Anki cloze 语法，包括代码块和解释文字。
7. 如果卡片包含 cloze 语法，就不要设置 `type: basic`、`type: basic-reversed` 或 `type: basic-type`。
8. `basic-type` 只适合短答案、精确拼写、符号输入，不适合长段答案。
9. `basic-reversed` 适合术语和定义的双向记忆，不适合长段复杂解释。
10. 每张卡只测一个核心知识点。长概念拆成多张卡。
11. 每张卡底部可以写 `tag:` 或 `tags:`，标签用短词，避免长句。
12. 不要在卡片内容里放独占一行的 `---`。
13. Markdown、代码块和 LaTeX 按 Obsidian 原生写法写，不要写 HTML。
14. 如果需要展示 cloze 语法本身，在 Basic 卡里写成 `{{ c1::answer }}`，不要写成可被 Anki 识别的形式。
15. 复杂 LaTeX 可以同步，但优先 cloze 文字说明，让公式完整展示；只有确实要考公式本身时才把 `\frac{...}{...}` 这类表达式放进 cloze。

### 推荐的 LLM 输出模板

```markdown
# Cards

## 概念名

一句话上下文，关键答案是{{c1::挖空内容}}。

tags: topic cloze
uuid:
path:
---

Front

## 问题标题

具体问题是什么？

Back

直接、完整、可复习的答案。

tags: topic basic
uuid:
path:
---
```

### LLM 质量标准

- 卡片应该能单独复习，不依赖页面上下文。
- Cloze 的挖空不要太多；通常一张卡 1-3 个 cloze 比较稳。
- 同一事实的多个侧面，拆成多张卡，而不是塞进一个巨大的 Back。
- 避免“是什么？”这种过宽问题，改成可判分的问题。
- 对代码题，Front 放问题和必要代码片段，Back 放答案和简短解释。
- 对数学题，保留完整符号定义，避免只挖一个没有上下文的符号。

## 排错

### 提示 cannot create note for unknown reason

最常见原因：Basic 系列卡片里出现了 Anki cloze 语法。检查 `Front`、`Back`、代码块和解释文字。

### Anki 渲染和 Obsidian 预览不同

Obsidian 预览使用 Obsidian 自己的 Markdown/LaTeX 渲染；Anki 使用 Modern 模板里的 renderer。外观会尽量接近，但不是同一个渲染引擎。

如果 Anki 里完全没有 Markdown/LaTeX 效果，先确认已经运行：

```bash
python3 /home/aac6fef/Developer/my_anki_template/anki_connect.py
```

### 同步后卡片没有删除

确认设置里 **Confirm before deleting** 是否打开。打开时需要在同步弹窗中确认删除。
