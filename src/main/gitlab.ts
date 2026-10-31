import { getConfig } from './config'
import { authHeaders, getValidAuth, refreshOAuth } from './auth'
import { httpRequest, networkError, parseJson } from './http'
import type { ApiRequest, ApiResult } from '../shared/types'

const statusText: Record<number, string> = {
  400: '请求参数错误',
  401: '登录已失效，请重新登录',
  403: '没有权限执行此操作',
  404: '资源不存在，或你没有访问权限',
  405: '当前状态不允许此操作',
  409: '资源冲突',
  422: '提交的数据未通过校验',
  429: '请求过于频繁，请稍后再试',
  500: 'GitLab 服务器内部错误',
  502: 'GitLab 网关错误',
  503: 'GitLab 服务暂不可用'
}

function gitlabMessage(data: unknown): string {
  if (!data) return ''
  if (typeof data === 'string') return data.slice(0, 300)
  const d = data as Record<string, unknown>
  const m = d.message ?? d.error_description ?? d.error
  if (!m) return ''
  return typeof m === 'string' ? m : JSON.stringify(m)
}

function safeApiPath(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//') && !path.includes('://') && !/[\r\n\\]/.test(path)
}

const inflight = new Set<AbortController>()
const byId = new Map<number, AbortController>()
const pendingCancel = new Set<number>()

export function cancelGitlab(id: number): void {
  if (!Number.isInteger(id)) return
  const ac = byId.get(id)
  if (ac) ac.abort()
  else if (pendingCancel.size < 200) pendingCancel.add(id)
}

/** 退出或窗口关闭时打断所有进行中的 GitLab 请求，避免进程被套接字拖住 */
export function cancelAllGitlab(): void {
  for (const ac of inflight) ac.abort()
  pendingCancel.clear()
}

function isAbort(e: NodeJS.ErrnoException, signal: AbortSignal): boolean {
  return signal.aborted || e.name === 'AbortError' || e.code === 'ABORT_ERR'
}

export async function gitlabRequest<T = unknown>(req: ApiRequest): Promise<ApiResult<T>> {
  const cfg = getConfig()
  let auth = await getValidAuth()
  if (!cfg.baseUrl || !auth) return { ok: false, status: 401, error: '尚未登录' }
  if (!safeApiPath(req.path)) return { ok: false, status: 0, error: '非法的 API 路径' }

  let url: URL
  try {
    url = new URL(cfg.baseUrl + '/api/v4' + req.path)
  } catch {
    return { ok: false, status: 0, error: 'GitLab 地址格式不正确' }
  }
  for (const [k, v] of Object.entries(req.query ?? {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
  }
  const body = req.body === undefined ? undefined : JSON.stringify(req.body)
  const ac = new AbortController()
  const id = typeof req.requestId === 'number' && Number.isInteger(req.requestId) ? req.requestId : undefined
  inflight.add(ac)
  if (id !== undefined) {
    if (pendingCancel.delete(id)) ac.abort()
    byId.set(id, ac)
  }

  try {
    if (ac.signal.aborted) return { ok: false, status: 0, error: '已取消' }
    const send = (a: NonNullable<typeof auth>) =>
      httpRequest(url, {
        method: req.method ?? 'GET',
        headers: {
          ...authHeaders(a),
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
        },
        body,
        ignoreTls: cfg.ignoreTls,
        signal: ac.signal
      })

    let res = await send(auth)
    if (res.status === 401 && auth.type === 'oauth') {
      const refreshed = await refreshOAuth()
      if (refreshed) {
        auth = refreshed
        res = await send(auth)
      }
    }

    const data = req.raw ? res.text : parseJson(res)
    if (res.status >= 400) {
      const base = statusText[res.status] ?? `请求失败（HTTP ${res.status}）`
      const msg = res.status === 401 ? '' : gitlabMessage(data)
      return { ok: false, status: res.status, error: msg ? `${base}：${msg}` : base }
    }
    const total = Number(res.headers['x-total'])
    return { ok: true, data: data as T, total: Number.isFinite(total) ? total : null }
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    if (isAbort(err, ac.signal)) return { ok: false, status: 0, error: '已取消' }
    return { ok: false, status: 0, error: networkError(err) }
  } finally {
    inflight.delete(ac)
    if (id !== undefined) byId.delete(id)
  }
}
