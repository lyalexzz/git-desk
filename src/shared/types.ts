export interface AppConfig {
  baseUrl: string
  ignoreTls: boolean
  pollMinutes: number
  notify: boolean
  hasToken: boolean
}

export interface SaveConfigInput {
  baseUrl: string
  token?: string
  ignoreTls: boolean
  pollMinutes: number
  notify: boolean
}

export type QueryValue = string | number | boolean | undefined | null

export interface ApiRequest {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  path: string
  query?: Record<string, QueryValue>
  body?: unknown
  raw?: boolean
}

export type ApiResult<T = unknown> =
  | { ok: true; data: T; total: number | null }
  | { ok: false; error: string; status: number }

export interface DesktopApi {
  getConfig(): Promise<AppConfig>
  saveConfig(input: SaveConfigInput): Promise<AppConfig>
  logout(): Promise<AppConfig>
  request<T = unknown>(req: ApiRequest): Promise<ApiResult<T>>
  openExternal(url: string): Promise<void>
  onNavigate(cb: (path: string) => void): () => void
  onTodoCount(cb: (count: number) => void): () => void
}
