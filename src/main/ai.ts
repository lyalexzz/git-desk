import type { WebContents } from 'electron'
import type { IncomingMessage } from 'node:http'
import { getAiSettings, normalizeAiBaseUrl } from './config'
import { httpRequest, httpStream, networkError } from './http'
import { SseParser } from './sse'
import type { AiChatRequest, AiConnection, AiResult, AiStreamEvent, AiUsage } from '../shared/ai'

const SERVER = 'AI 服务'
const STREAM_TIMEOUT = 5 * 60_000

interface Resolved {
  baseUrl: string
  apiKey: string
  ignoreTls: boolean
  model: string
  temperature: number | null
}

function resolve(conn?: AiConnection): Resolved {
  const s = getAiSettings()
  if (!conn) return s
  return {
    baseUrl: normalizeAiBaseUrl(conn.baseUrl),
    apiKey: conn.apiKey?.trim() || s.apiKey,
    ignoreTls: conn.ignoreTls,
    model: conn.model?.trim() ?? s.model,
    temperature: conn.temperature === undefined ? s.temperature : conn.temperature
  }
}

/** 用户可能只填了根地址（如 https://api.deepseek.com），此时再尝试补 /v1 */
function candidates(baseUrl: string): string[] {
  if (/\/v\d+[a-z0-9]*$/i.test(baseUrl) || /compatible-mode/i.test(baseUrl)) return [baseUrl]
  return [baseUrl, baseUrl + '/v1']
}

function toUrl(base: string, path: string): URL {
  try {
    const url = new URL(base + path)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error()
    return url
  } catch {
    throw new AiError('AI 接口地址格式不正确，应以 http:// 或 https:// 开头')
  }
}

function headers(r: Resolved): Record<string, string> {
  return {
    Accept: 'application/json, text/event-stream',
    'Content-Type': 'application/json',
    ...(r.apiKey ? { Authorization: `Bearer ${r.apiKey}` } : {})
  }
}

class AiError extends Error {}

function providerMessage(text: string): string {
  try {
    const d = JSON.parse(text) as Record<string, unknown>
    const e = d.error ?? d.message ?? d.detail ?? d.msg
    if (typeof e === 'string') return e
    if (e && typeof e === 'object') {
      const m = (e as Record<string, unknown>).message
      return typeof m === 'string' ? m : JSON.stringify(e)
    }
  } catch {
    // not JSON
  }
  return /<html/i.test(text) ? '' : text.trim().slice(0, 300)
}

function statusError(status: number, text: string): AiError {
  const base =
    status === 400
      ? '请求参数错误（可能是模型名称或参数不被支持）'
      : status === 401
        ? 'API Key 无效或已过期'
        : status === 402
          ? '账户余额不足，请到服务商控制台充值'
          : status === 403
            ? '没有权限访问该模型，请检查 Key 的权限或模型是否已开通'
            : status === 404
              ? '接口地址或模型不存在，请检查 API 地址和模型名称'
              : status === 413
                ? '发送的内容过长，请在设置中调小「审核内容上限」'
                : status === 429
                  ? '请求过于频繁或额度已用尽，请稍后再试'
                  : status >= 500
                    ? `AI 服务暂时不可用（HTTP ${status}）`
                    : `AI 请求失败（HTTP ${status}）`
  const msg = providerMessage(text)
  return new AiError(msg ? `${base}：${msg}` : base)
}

function errorText(e: unknown): string {
  if (e instanceof AiError) return e.message
  const err = e as NodeJS.ErrnoException
  return err.code ? networkError(err, SERVER) : `AI 请求失败：${err.message}`
}

function readText(res: IncomingMessage): Promise<string> {
  return new Promise((ok, fail) => {
    const chunks: Buffer[] = []
    res.on('data', (c: Buffer) => chunks.push(c))
    res.on('end', () => ok(Buffer.concat(chunks).toString('utf8')))
    res.on('error', fail)
  })
}

/** 兼容 {data:[{id}]}（OpenAI/Ollama）、{models:[{name}]}、{data:{models:[]}} 以及字符串数组 */
export function modelIds(data: unknown): string[] | null {
  const pick = (v: unknown): unknown[] | null => {
    if (Array.isArray(v)) return v
    if (!v || typeof v !== 'object') return null
    const d = v as Record<string, unknown>
    return pick(d.data) ?? pick(d.models) ?? pick(d.list)
  }
  const items = pick(data)
  if (!items) return null
  const ids = items
    .map((m) => {
      if (typeof m === 'string') return m
      if (!m || typeof m !== 'object') return ''
      const o = m as Record<string, unknown>
      const id = o.id ?? o.model ?? o.name
      return typeof id === 'string' ? id.trim() : ''
    })
    .filter(Boolean)
  return [...new Set(ids)].sort()
}

export async function listModels(conn: AiConnection): Promise<AiResult<{ models: string[]; baseUrl: string }>> {
  try {
    const r = resolve(conn)
    if (!r.baseUrl) return { ok: false, error: '请先填写 API 地址' }
    const list = candidates(r.baseUrl)
    let lastError: AiError | null = null
    for (const base of list) {
      const res = await httpRequest(toUrl(base, '/models'), { headers: headers(r), ignoreTls: r.ignoreTls })
      let data: unknown
      try {
        data = JSON.parse(res.text)
      } catch {
        data = null
      }
      const ids = res.status < 400 ? modelIds(data) : null
      if (ids) return { ok: true, data: { models: ids, baseUrl: base } }
      lastError =
        res.status >= 400
          ? statusError(res.status, res.text)
          : new AiError('该地址没有返回模型列表，可能不是 OpenAI 兼容接口，或服务商不支持拉取模型（可直接手动填写模型名称）')
      if (res.status === 401 || res.status === 402 || res.status === 403) break
    }
    return { ok: false, error: lastError?.message ?? '拉取模型失败' }
  } catch (e) {
    return { ok: false, error: errorText(e) }
  }
}

export async function testAi(conn: AiConnection): Promise<AiResult<string>> {
  try {
    const r = resolve(conn)
    if (!r.baseUrl) return { ok: false, error: '请先填写 API 地址' }
    if (!r.model) return { ok: false, error: '请先选择模型' }
    const body = JSON.stringify({
      model: r.model,
      messages: [{ role: 'user', content: '这是一条连通性测试，请只回复“连接成功”四个字。' }],
      stream: false,
      ...(r.temperature != null ? { temperature: r.temperature } : {})
    })
    const started = Date.now()
    const list = candidates(r.baseUrl)
    for (let i = 0; i < list.length; i++) {
      const res = await httpRequest(toUrl(list[i], '/chat/completions'), {
        method: 'POST',
        headers: headers(r),
        body,
        ignoreTls: r.ignoreTls,
        timeout: 120_000
      })
      if (res.status === 404 && i < list.length - 1) continue
      if (res.status >= 400) return { ok: false, error: statusError(res.status, res.text).message }
      const seconds = ((Date.now() - started) / 1000).toFixed(1)
      try {
        const d = JSON.parse(res.text) as { choices?: { message?: { content?: string } }[] }
        const reply = d.choices?.[0]?.message?.content?.trim()
        return {
          ok: true,
          data: reply ? `连接成功（${seconds} 秒），模型回复：${reply.slice(0, 100)}` : `连接成功（${seconds} 秒）`
        }
      } catch {
        return { ok: false, error: '接口返回的不是 JSON，请检查 API 地址是否为 OpenAI 兼容接口' }
      }
    }
    return { ok: false, error: '接口地址不存在' }
  } catch (e) {
    return { ok: false, error: errorText(e) }
  }
}

const running = new Map<string, AbortController>()

export function cancelChat(id: string): void {
  running.get(id)?.abort()
}

export function cancelAllChats(): void {
  for (const ac of running.values()) ac.abort()
}

interface ChunkJson {
  model?: string
  error?: unknown
  usage?: AiUsage | null
  choices?: {
    finish_reason?: string | null
    delta?: { content?: string | null; reasoning_content?: string | null; reasoning?: string | null }
    message?: { content?: string | null; reasoning_content?: string | null; reasoning?: string | null }
  }[]
}

export async function streamChat(wc: WebContents, req: AiChatRequest): Promise<void> {
  const emit = (e: AiStreamEvent): void => {
    if (!wc.isDestroyed()) wc.send('ai:stream', e)
  }
  const id = req.id
  const ac = new AbortController()
  running.set(id, ac)
  const onGone = (): void => ac.abort()
  wc.once('destroyed', onGone)
  let res: IncomingMessage | null = null
  const stopBody = (): void => {
    const current = res
    if (!current || current.destroyed) return
    current.on('error', () => {})
    current.destroy()
  }
  ac.signal.addEventListener('abort', stopBody)
  try {
    const r = resolve()
    if (!r.baseUrl || !r.model) throw new AiError('尚未配置 AI，请先到「设置 → AI 助手」中配置')
    const body = JSON.stringify({
      model: r.model,
      messages: req.messages,
      stream: true,
      ...(r.temperature != null ? { temperature: r.temperature } : {})
    })

    const list = candidates(r.baseUrl)
    for (let i = 0; i < list.length; i++) {
      res = await httpStream(toUrl(list[i], '/chat/completions'), {
        method: 'POST',
        headers: headers(r),
        body,
        ignoreTls: r.ignoreTls,
        timeout: STREAM_TIMEOUT,
        signal: ac.signal
      })
      if (res.statusCode === 404 && i < list.length - 1) {
        res.on('error', () => {})
        res.destroy()
        res = null
        continue
      }
      break
    }
    if (!res) throw new AiError('接口地址不存在')
    const status = res.statusCode ?? 0
    if (status >= 400) throw statusError(status, await readText(res))

    let model = r.model
    let finishReason: string | null = null
    let usage: AiUsage | undefined
    let finished = false
    const handle = (data: string): void => {
      if (data.trim() === '[DONE]') {
        finished = true
        return
      }
      let obj: ChunkJson
      try {
        obj = JSON.parse(data) as ChunkJson
      } catch {
        return
      }
      if (obj.error) throw new AiError(`AI 服务返回错误：${providerMessage(JSON.stringify(obj))}`)
      if (obj.model) model = obj.model
      if (obj.usage) usage = obj.usage
      const choice = obj.choices?.[0]
      if (!choice) return
      if (choice.finish_reason) finishReason = choice.finish_reason
      const d = choice.delta ?? choice.message
      const delta = d?.content || undefined
      const reasoning = d?.reasoning_content || d?.reasoning || undefined
      if (delta || reasoning) emit({ type: 'chunk', id, delta, reasoning })
    }

    const isJson = String(res.headers['content-type'] ?? '').includes('application/json')
    if (isJson) {
      // 部分网关会忽略 stream 参数，直接返回完整 JSON
      handle(await readText(res))
    } else {
      const parser = new SseParser()
      for await (const chunk of res) {
        for (const data of parser.push(chunk as Buffer)) handle(data)
        if (finished) break
      }
      if (!finished) for (const data of parser.end()) handle(data)
    }
    if (finished) stopBody()
    emit({ type: 'done', id, model, finishReason, usage })
  } catch (e) {
    stopBody()
    if (ac.signal.aborted) emit({ type: 'done', id, model: '', finishReason: 'cancelled' })
    else emit({ type: 'error', id, error: errorText(e) })
  } finally {
    ac.signal.removeEventListener('abort', stopBody)
    if (!wc.isDestroyed()) wc.removeListener('destroyed', onGone)
    running.delete(id)
  }
}
