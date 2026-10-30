import http from 'node:http'
import https from 'node:https'
import type { IncomingMessage } from 'node:http'
import { getConfig, getToken } from './config'
import type { ApiRequest, ApiResult } from '../shared/types'

const statusText: Record<number, string> = {
  400: '请求参数错误',
  401: '访问令牌无效或已过期',
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

function networkError(e: NodeJS.ErrnoException): string {
  switch (e.code) {
    case 'ECONNREFUSED':
      return '无法连接 GitLab 服务器（连接被拒绝）'
    case 'ENOTFOUND':
      return '找不到 GitLab 服务器，请检查地址或 DNS'
    case 'ETIMEDOUT':
    case 'ECONNRESET':
      return '连接 GitLab 服务器超时或被重置'
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'SELF_SIGNED_CERT_IN_CHAIN':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
    case 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY':
    case 'CERT_HAS_EXPIRED':
      return 'HTTPS 证书校验失败。内网自签证书请在“设置”中开启“忽略证书校验”'
    default:
      return `网络错误：${e.message}`
  }
}

export function gitlabRequest<T = unknown>(req: ApiRequest): Promise<ApiResult<T>> {
  const cfg = getConfig()
  const token = getToken()
  if (!cfg.baseUrl || !token) {
    return Promise.resolve({ ok: false, status: 0, error: '尚未配置 GitLab 地址或访问令牌' })
  }
  if (!req.path.startsWith('/')) {
    return Promise.resolve({ ok: false, status: 0, error: `非法的 API 路径：${req.path}` })
  }

  let url: URL
  try {
    url = new URL(cfg.baseUrl + '/api/v4' + req.path)
  } catch {
    return Promise.resolve({ ok: false, status: 0, error: 'GitLab 地址格式不正确' })
  }
  for (const [k, v] of Object.entries(req.query ?? {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
  }

  const payload = req.body === undefined ? undefined : JSON.stringify(req.body)
  const headers: Record<string, string | number> = { 'PRIVATE-TOKEN': token, Accept: 'application/json' }
  if (payload !== undefined) {
    headers['Content-Type'] = 'application/json'
    headers['Content-Length'] = Buffer.byteLength(payload)
  }

  return new Promise((resolve) => {
    const onResponse = (res: IncomingMessage): void => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => {
        const status = res.statusCode ?? 0
        const text = Buffer.concat(chunks).toString('utf8')
        let data: unknown = text
        if (!req.raw && text && String(res.headers['content-type'] ?? '').includes('json')) {
          try {
            data = JSON.parse(text)
          } catch {
            // keep raw text
          }
        }
        if (status >= 400) {
          const base = statusText[status] ?? `请求失败（HTTP ${status}）`
          const msg = gitlabMessage(data)
          resolve({ ok: false, status, error: msg ? `${base}：${msg}` : base })
          return
        }
        const total = Number(res.headers['x-total'])
        resolve({ ok: true, data: data as T, total: Number.isFinite(total) ? total : null })
      })
    }

    const options = { method: req.method ?? 'GET', headers, timeout: 30000 }
    const r =
      url.protocol === 'https:'
        ? https.request(url, { ...options, rejectUnauthorized: !cfg.ignoreTls }, onResponse)
        : http.request(url, options, onResponse)
    r.on('timeout', () => r.destroy(Object.assign(new Error('请求超时'), { code: 'ETIMEDOUT' })))
    r.on('error', (e: NodeJS.ErrnoException) => resolve({ ok: false, status: 0, error: networkError(e) }))
    if (payload !== undefined) r.write(payload)
    r.end()
  })
}
