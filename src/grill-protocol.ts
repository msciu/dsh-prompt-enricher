/**
 * The elicitation child's instruction set.
 *
 * `GRILL_BODY` is a VERBATIM copy of the body (everything after the YAML
 * frontmatter) of `grill-me`'s SKILL.md. It is inlined rather than read from
 * the skills registry on purpose: the child must get the same instruction on
 * every host, even when the user has no local skill installed or a different
 * version of it. Changing it changes the plugin's model behaviour contract, so
 * `src/protocol.ts`'s parser must be re-checked in the same change.
 */

/** Verbatim body of `grill-me` (SKILL.md, frontmatter excluded). */
export const GRILL_BODY = `围绕这个计划的每个方面持续追问我，直到我们达成共同理解。沿着 design tree 的每个分支走下去，一次解决一个决策之间的依赖。每个问题都提供你的推荐答案。

一次只问一个问题。

如果某个问题可以通过探索 codebase 回答，就去探索 codebase。`

/**
 * The envelope contract appended after {@link GRILL_BODY}.
 *
 * It exists because the panel renders questions as cards: the answer shape has
 * to be machine-readable. It also names the exit condition, so the child knows
 * when to stop asking and emit the final document.
 */
export const ENVELOPE_CONTRACT = `## 输出格式

你正在帮助用户澄清一份**提示词文档**。用户会分多轮回答你的问题。

每次回复**只输出一个** \`\`\`json 代码块，不要输出任何其他文字。

提出下一个问题时：

\`\`\`json
{
  "kind": "question",
  "id": "q1",
  "question": "要问的问题，一次只问一个",
  "recommended": "你推荐的答案",
  "options": ["可选项一", "可选项二"],
  "rationale": "为什么这样推荐，引用文档里的具体依据"
}
\`\`\`

\`options\` 可以省略（开放式问题）。\`recommended\` 与 \`rationale\` 必填。

当所有影响实现的歧义都已消除，输出最终文档：

\`\`\`json
{
  "kind": "final",
  "document": "完整的、可直接使用的提示词文档全文（Markdown）"
}
\`\`\`

要求：

- 一次只问一个问题，问最有信息量的那个。
- 每个问题都要给出推荐答案和理由；不要只提问。
- 提问前先读用户给的文档；能从文档本身推断出来的，不要问用户。
- 只输出上述 JSON，不要有前后缀说明。
- \`final\` 里的 \`document\` 是完整文档，不是修改说明。`

/** Build the child's opening message: the protocol, then the document under review. */
export function elicitationSeed(document: string): string {
  return [
    GRILL_BODY,
    '',
    ENVELOPE_CONTRACT,
    '',
    '<待澄清的提示词文档>',
    document,
    '</待澄清的提示词文档>',
    '',
    '现在开始：提出第一个问题。',
  ].join('\n')
}

/** The instruction prepended to each user ruling delivered to the child. */
export function answerPrompt(answer: string): string {
  return `我的回答：${answer}\n\n请继续：提出下一个问题，或输出最终文档。`
}
