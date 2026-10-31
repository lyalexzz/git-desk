import http from 'node:http'
import https from 'node:https'
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http'

export interface HttpResponse {
  status: number
  headers: IncomingHttpHeaders
  text: string
}

export interface HttpOptions {
  method?: string
  headers?: Record<string, string | number>
  body?: string
  ignoreTls: boolean
  /** 套接字空闲超时（毫秒），默认 30 秒 */
  timeout?: number
  signal?: AbortSignal
}

function send(url: URL, opts: HttpOptions, onResponse: (res: IncomingMessage) => void, reject: (e: Error) => void): void {
  const headers = { ...opts.headers }
  if (opts.body !== undefined) headers['Content-Length'] = Buffer.byteLength(opts.body)
  const options = { method: opts.method ?? 'GET', headers, timeout: opts.timeout ?? 30000, signal: opts.signal }
  const r =
    url.protocol === 'https:'
      ? https.request(url, { ...options, rejectUnauthorized: !opts.ignoreTls }, onResponse)
      : http.request(url, options, onResponse)
  r.on('timeout', () => r.destroy(Object.assign(new Error('请求超时'), { code: 'ETIMEDOUT' })))
  r.on('error', reject)
  if (opts.body !== undefined) r.write(opts.body)
  r.end()
}

export function httpRequest(url: URL, opts: HttpOptions): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    send(
      url,
      opts,
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') })
        )
        res.on('error', reject)
      },
      reject
    )
  })
}

/** 只等到响应头，响应体由调用方按流读取；请求出错会在 res 上触发 error */
export function httpStream(url: URL, opts: HttpOptions): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => send(url, opts, resolve, reject))
}

export function parseJson(res: HttpResponse): unknown {
  if (!res.text || !String(res.headers['content-type'] ?? '').includes('json')) return res.text
  try {
    return JSON.parse(res.text)
  } catch {
    return res.text
  }
}

export function networkError(e: NodeJS.ErrnoException, server = 'GitLab 服务器'): string {
  switch (e.code) {
    case 'ECONNREFUSED':
      return `无法连接 ${server}（连接被拒绝）`
    case 'ENOTFOUND':
      return `找不到 ${server}，请检查地址或 DNS`
    case 'ETIMEDOUT':
    case 'ECONNRESET':
      return `连接 ${server}超时或被重置`
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'SELF_SIGNED_CERT_IN_CHAIN':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
    case 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY':
    case 'CERT_HAS_EXPIRED':
      return 'HTTPS 证书校验失败。内网自签证书请开启“忽略证书校验”'
    default:
      return `网络错误：${e.message}`
  }
}
