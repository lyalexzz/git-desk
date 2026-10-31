export interface AiConfig {
  baseUrl: string
  model: string
  /** null 表示不传，使用模型默认值（部分推理模型不支持 temperature） */
  temperature: number | null
  systemPrompt: string
  ignoreTls: boolean
  /** 审核时发送给模型的代码变更字符上限 */
  maxChars: number
  hasApiKey: boolean
  configured: boolean
}

export interface AiPatch {
  baseUrl?: string
  /** 留空表示不修改，除非 clearApiKey 为 true */
  apiKey?: string
  clearApiKey?: boolean
  model?: string
  temperature?: number | null
  systemPrompt?: string
  ignoreTls?: boolean
  maxChars?: number
}

/** 设置页里尚未保存的连接参数；apiKey 为空时使用已保存的 Key */
export interface AiConnection {
  baseUrl: string
  apiKey?: string
  ignoreTls: boolean
  model?: string
  temperature?: number | null
}

export type AiResult<T> = { ok: true; data: T } | { ok: false; error: string }

export interface AiMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface AiChatRequest {
  id: string
  messages: AiMessage[]
}

export type AiStreamEvent =
  | { type: 'chunk'; id: string; delta?: string; reasoning?: string }
  | { type: 'done'; id: string; model: string; finishReason: string | null; usage?: AiUsage }
  | { type: 'error'; id: string; error: string }

export interface AiUsage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}

export const DEFAULT_AI_MAX_CHARS = 60000

export const DEFAULT_REVIEW_PROMPT = `你是一名资深的代码审核专家，熟悉主流编程语言、框架和工程实践。请审核用户提供的合并请求（Merge Request）代码变更。

要求：
1. 使用中文，以 Markdown 格式输出，包含以下小节：
   ## 总体评价
   用两三句话概括本次变更的目的、质量和主要风险。
   ## 问题列表
   按严重程度分组：**严重**（缺陷、安全漏洞、数据丢失、明显的逻辑错误）、**一般**（潜在 bug、边界条件、性能、可维护性）、**建议**（命名、风格、可读性）。
   每个问题包含：\`文件:行号\`、问题描述、建议修改（必要时给出简短的代码片段）。没有问题的分组写“无”。
   ## 优点
   ## 是否建议合并
   给出“建议合并 / 修改后合并 / 不建议合并”之一，并说明理由。
2. 只针对变更内容提出意见，必须具体、可操作；不要臆造差异中不存在的代码，不确定的地方请明确说明“需要确认”。
3. 行号：差异中“+”和空格开头的行标注的是新文件行号，“-”开头的行标注的是旧文件行号。
4. 部分文件可能因为过大或为二进制文件而被省略，不要对省略的文件做推测。`
