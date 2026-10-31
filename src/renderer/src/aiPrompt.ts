import type { Diff, MergeRequest } from './types'

export type ReviewFocus = 'all' | 'security' | 'performance' | 'style'

export const focusOptions: { value: ReviewFocus; label: string; prompt: string }[] = [
  { value: 'all', label: '全面', prompt: '' },
  {
    value: 'security',
    label: '安全',
    prompt: '本次请重点关注安全问题：注入、越权、敏感信息泄露、不安全的配置与依赖、输入校验、加解密使用等。'
  },
  {
    value: 'performance',
    label: '性能',
    prompt: '本次请重点关注性能问题：算法复杂度、N+1 查询、重复计算、不必要的 IO 和内存分配、并发与锁、缓存等。'
  },
  {
    value: 'style',
    label: '规范',
    prompt: '本次请重点关注代码规范与可维护性：命名、结构、重复代码、错误处理、日志、注释和测试覆盖等。'
  }
]

const SKIP_PATTERNS: [RegExp, string][] = [
  [/(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|composer\.lock|Gemfile\.lock|Cargo\.lock|poetry\.lock|go\.sum)$/i, '依赖锁文件'],
  [/\.(min\.js|min\.css|map)$/i, '压缩或 source map 文件'],
  [/\.(png|jpe?g|gif|ico|webp|pdf|zip|jar|exe|dll|so|woff2?|ttf)$/i, '二进制文件']
]

export interface ReviewInput {
  prompt: string
  files: number
  chars: number
  skipped: { path: string; reason: string }[]
  truncated: string[]
}

/** 给每一行标上行号：+ 和空格行用新文件行号，- 行用旧文件行号 */
export function numberDiff(diff: string): string {
  let oldLn = 0
  let newLn = 0
  const out: string[] = []
  for (const line of diff.replace(/\n$/, '').split('\n')) {
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
    if (h) {
      oldLn = Number(h[1])
      newLn = Number(h[2])
      out.push(line)
    } else if (line.startsWith('+')) {
      out.push(`+${String(newLn++).padStart(5)} ${line.slice(1)}`)
    } else if (line.startsWith('-')) {
      out.push(`-${String(oldLn++).padStart(5)} ${line.slice(1)}`)
    } else if (line.startsWith('\\')) {
      out.push(line)
    } else {
      out.push(` ${String(newLn).padStart(5)} ${line.slice(1)}`)
      oldLn++
      newLn++
    }
  }
  return out.join('\n')
}

function fileTitle(d: Diff): string {
  if (d.new_file) return `${d.new_path}（新增）`
  if (d.deleted_file) return `${d.old_path}（删除）`
  if (d.renamed_file) return `${d.new_path}（由 ${d.old_path} 重命名）`
  return d.new_path
}

export function buildReviewInput(mr: MergeRequest, diffs: Diff[], maxChars: number, focus: ReviewFocus): ReviewInput {
  const perFile = Math.max(4000, Math.floor(maxChars / 3))
  const skipped: ReviewInput['skipped'] = []
  const truncated: string[] = []
  const sections: string[] = []
  let used = 0

  for (const d of diffs) {
    const path = d.deleted_file ? d.old_path : d.new_path
    const skip = SKIP_PATTERNS.find(([re]) => re.test(path))
    if (skip) {
      skipped.push({ path, reason: skip[1] })
      continue
    }
    if (d.deleted_file) {
      sections.push(`### ${fileTitle(d)}\n（整个文件被删除，内容省略）`)
      continue
    }
    if (!d.diff?.trim()) {
      skipped.push({ path, reason: d.renamed_file ? '仅重命名，无内容变更' : '二进制文件或差异过大（GitLab 未返回内容）' })
      continue
    }
    let body = numberDiff(d.diff)
    if (body.length > perFile) {
      body = body.slice(0, perFile) + '\n…（该文件差异过长，后续内容已截断）'
      truncated.push(path)
    }
    if (used + body.length > maxChars) {
      skipped.push({ path, reason: '超出审核内容上限' })
      continue
    }
    used += body.length
    sections.push(`### ${fileTitle(d)}\n\`\`\`\`diff\n${body}\n\`\`\`\``)
  }

  const desc = (mr.description ?? '').trim()
  const parts = [
    '请审核以下合并请求的代码变更。',
    `标题：${mr.title}`,
    `分支：${mr.source_branch} → ${mr.target_branch}`,
    `作者：${mr.author.name}`,
    `描述：\n${desc ? desc.slice(0, 3000) : '（无）'}`
  ]
  const focusPrompt = focusOptions.find((f) => f.value === focus)?.prompt
  if (focusPrompt) parts.push(focusPrompt)
  if (skipped.length) {
    parts.push('以下文件没有包含在差异中，请不要推测其内容：\n' + skipped.map((s) => `- ${s.path}：${s.reason}`).join('\n'))
  }
  if (truncated.length) parts.push('以下文件的差异过长已被截断：\n' + truncated.map((p) => `- ${p}`).join('\n'))
  parts.push(`## 代码变更（${sections.length} 个文件）\n\n${sections.join('\n\n')}`)

  return { prompt: parts.join('\n\n'), files: sections.length, chars: used, skipped, truncated }
}

/** 部分模型（如 Ollama 上的 R1 / Qwen3）把思考过程放在 <think> 标签里 */
export function splitThink(content: string): { think: string; answer: string } {
  const m = /^\s*<think>([\s\S]*?)(<\/think>|$)/.exec(content)
  if (!m) return { think: '', answer: content }
  return { think: m[1].trim(), answer: m[2] ? content.slice(m[0].length).trimStart() : '' }
}
