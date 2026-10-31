import { getConfig } from './config'
import { getValidAuth } from './auth'
import { httpRequest, networkError, parseJson } from './http'
import type { ApiRequest, ApiResult, QueryValue } from '../shared/types'

const statusText: Record<number, string> = {
  400: '请求参数错误',
  401: '登录已失效，请重新登录',
  403: '没有权限执行此操作',
  404: '资源不存在，或你没有访问权限',
  405: '当前状态不允许此操作',
  409: '资源冲突',
  422: '提交的数据未通过校验',
  429: '请求过于频繁，请稍后再试',
  500: 'GitHub 服务器内部错误',
  502: 'GitHub 网关错误',
  503: 'GitHub 服务暂不可用'
}

function githubMessage(data: unknown): string {
  if (!data) return ''
  if (typeof data === 'string') return data.slice(0, 300)
  const d = data as Record<string, unknown>
  const m = d.message ?? d.error
  if (!m) return ''
  return typeof m === 'string' ? m : JSON.stringify(m)
}

function safeApiPath(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//') && !path.includes('://') && !/[\r\n\\]/.test(path)
}

/** 网页地址 → API 根：github.com → api.github.com；企业版 host → host/api/v3 */
export function githubApiRoot(webBase: string): string {
  const u = new URL(webBase)
  const host = u.hostname.toLowerCase()
  if (host === 'github.com' || host === 'www.github.com') return 'https://api.github.com'
  return `${u.protocol}//${u.host}/api/v3`
}

function q(query: Record<string, QueryValue> | undefined, key: string): string | undefined {
  const v = query?.[key]
  if (v === undefined || v === null || v === '') return undefined
  return String(v)
}

function parseLinkTotal(link: string | string[] | undefined, page: number, perPage: number, got: number): number | null {
  const raw = Array.isArray(link) ? link.join(',') : link
  if (!raw) return got < perPage ? (page - 1) * perPage + got : null
  const last = /[?&]page=(\d+)[^>]*>;\s*rel="last"/.exec(raw)
  if (last) return Number(last[1]) * perPage
  return got < perPage ? (page - 1) * perPage + got : null
}

type GhRepo = {
  id: number
  name: string
  full_name: string
  description: string | null
  html_url: string
  stargazers_count: number
  updated_at: string
  visibility?: string
  private?: boolean
  default_branch?: string
  clone_url?: string
  ssh_url?: string
  empty?: boolean
  owner?: { login: string }
}

function mapRepo(r: GhRepo) {
  const visibility = r.visibility || (r.private ? 'private' : 'public')
  return {
    id: r.id,
    name: r.name,
    name_with_namespace: r.full_name.replace('/', ' / '),
    path_with_namespace: r.full_name,
    description: r.description,
    default_branch: r.default_branch,
    web_url: r.html_url,
    star_count: r.stargazers_count,
    last_activity_at: r.updated_at,
    visibility,
    http_url_to_repo: r.clone_url,
    ssh_url_to_repo: r.ssh_url,
    empty_repo: Boolean(r.empty)
  }
}

type GhUser = {
  id: number
  login: string
  name?: string | null
  email?: string | null
  html_url: string
  avatar_url?: string
}

function mapUser(u: GhUser) {
  return {
    id: u.id,
    username: u.login,
    name: u.name || u.login,
    email: u.email || undefined,
    state: 'active',
    web_url: u.html_url
  }
}

type GhIssue = {
  id: number
  number: number
  title: string
  body: string | null
  state: string
  user: GhUser
  assignees?: GhUser[]
  labels?: { name: string }[]
  html_url: string
  created_at: string
  updated_at: string
  comments: number
  pull_request?: unknown
  milestone?: { title: string } | null
}

function mapIssue(i: GhIssue, projectId: number, fullName: string) {
  return {
    id: i.id,
    iid: i.number,
    project_id: projectId,
    title: i.title,
    description: i.body,
    state: i.state === 'open' ? 'opened' : 'closed',
    author: mapUser(i.user),
    assignees: (i.assignees || []).map(mapUser),
    labels: (i.labels || []).map((l) => l.name),
    web_url: i.html_url,
    created_at: i.created_at,
    updated_at: i.updated_at,
    references: { full: `${fullName}#${i.number}` },
    user_notes_count: i.comments,
    milestone: i.milestone
  }
}

type GhPr = {
  id: number
  number: number
  title: string
  body: string | null
  state: string
  merged_at?: string | null
  draft?: boolean
  user: GhUser
  assignees?: GhUser[]
  requested_reviewers?: GhUser[]
  html_url: string
  created_at: string
  updated_at: string
  comments?: number
  head: { ref: string; sha: string }
  base: { ref: string; sha: string }
  mergeable?: boolean | null
}

function mapPr(p: GhPr, projectId: number, fullName: string) {
  let state = 'opened'
  if (p.merged_at) state = 'merged'
  else if (p.state === 'closed') state = 'closed'
  return {
    id: p.id,
    iid: p.number,
    number: p.number,
    project_id: projectId,
    title: p.title,
    description: p.body,
    state,
    author: mapUser(p.user),
    assignees: (p.assignees || []).map(mapUser),
    reviewers: (p.requested_reviewers || []).map(mapUser),
    source_branch: p.head.ref,
    target_branch: p.base.ref,
    web_url: p.html_url,
    created_at: p.created_at,
    updated_at: p.updated_at,
    draft: Boolean(p.draft),
    has_conflicts: p.mergeable === false,
    references: { full: `${fullName}#${p.number}` },
    user_notes_count: p.comments ?? 0,
    diff_refs: {
      base_sha: p.base.sha,
      start_sha: p.base.sha,
      head_sha: p.head.sha
    }
  }
}

type GhComment = {
  id: number
  body: string
  user: GhUser
  created_at: string
}

function mapNote(c: GhComment) {
  return {
    id: c.id,
    body: c.body,
    author: mapUser(c.user),
    created_at: c.created_at,
    system: false
  }
}

type GhBranch = {
  name: string
  protected?: boolean
  commit?: { sha: string; commit?: { author?: { date?: string }; message?: string } }
}

function mapBranch(b: GhBranch, defaultBranch?: string) {
  return {
    name: b.name,
    default: b.name === defaultBranch,
    protected: Boolean(b.protected),
    commit: b.commit
      ? {
          id: b.commit.sha,
          short_id: b.commit.sha.slice(0, 8),
          title: b.commit.commit?.message?.split('\n')[0] || '',
          message: b.commit.commit?.message || '',
          author_name: '',
          author_email: '',
          created_at: b.commit.commit?.author?.date || '',
          committed_date: b.commit.commit?.author?.date || ''
        }
      : undefined
  }
}

type GhCommit = {
  sha: string
  commit: { message: string; author?: { name?: string; email?: string; date?: string } }
  html_url?: string
  parents?: { sha: string }[]
  stats?: { additions: number; deletions: number; total: number }
}

function mapCommit(c: GhCommit) {
  const msg = c.commit.message || ''
  return {
    id: c.sha,
    short_id: c.sha.slice(0, 8),
    title: msg.split('\n')[0],
    message: msg,
    author_name: c.commit.author?.name || '',
    author_email: c.commit.author?.email || '',
    created_at: c.commit.author?.date || '',
    committed_date: c.commit.author?.date || '',
    parent_ids: (c.parents || []).map((p) => p.sha),
    web_url: c.html_url,
    stats: c.stats
  }
}

const repoCache = new Map<number, string>() // id -> full_name

async function resolveFullName(
  apiRoot: string,
  headers: Record<string, string>,
  ignoreTls: boolean,
  projectKey: string,
  signal?: AbortSignal
): Promise<{ id: number; full_name: string } | null> {
  if (projectKey.includes('/')) {
    const r = await rawGet(apiRoot, headers, ignoreTls, `/repos/${projectKey}`, signal)
    if (!r.ok) return null
    const repo = r.data as GhRepo
    repoCache.set(repo.id, repo.full_name)
    return { id: repo.id, full_name: repo.full_name }
  }
  const id = Number(projectKey)
  if (repoCache.has(id)) return { id, full_name: repoCache.get(id)! }
  const r = await rawGet(apiRoot, headers, ignoreTls, `/repositories/${id}`, signal)
  if (!r.ok) return null
  const repo = r.data as GhRepo
  repoCache.set(repo.id, repo.full_name)
  return { id: repo.id, full_name: repo.full_name }
}

async function rawGet(
  apiRoot: string,
  headers: Record<string, string>,
  ignoreTls: boolean,
  path: string,
  signal?: AbortSignal,
  query?: Record<string, string>
): Promise<{ ok: true; data: unknown; total: number | null; status: number } | { ok: false; status: number; error: string }> {
  const url = new URL(apiRoot + path)
  for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, v)
  try {
    const res = await httpRequest(url, { method: 'GET', headers: { ...headers, Accept: 'application/vnd.github+json' }, ignoreTls, signal })
    const data = parseJson(res)
    if (res.status >= 400) {
      const base = statusText[res.status] ?? `请求失败（HTTP ${res.status}）`
      const msg = githubMessage(data)
      return { ok: false, status: res.status, error: msg ? `${base}：${msg}` : base }
    }
    const page = Number(url.searchParams.get('page') || 1)
    const perPage = Number(url.searchParams.get('per_page') || 30)
    const arr = Array.isArray(data) ? data : null
    const total = arr ? parseLinkTotal(res.headers.link, page, perPage, arr.length) : null
    return { ok: true, data, total, status: res.status }
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    if (signal?.aborted || err.name === 'AbortError') return { ok: false, status: 0, error: '已取消' }
    return { ok: false, status: 0, error: networkError(err) }
  }
}

async function rawSend(
  apiRoot: string,
  headers: Record<string, string>,
  ignoreTls: boolean,
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal
): Promise<ApiResult<unknown>> {
  const url = new URL(apiRoot + path)
  const bodyStr = body === undefined ? undefined : JSON.stringify(body)
  try {
    const res = await httpRequest(url, {
      method,
      headers: {
        ...headers,
        Accept: 'application/vnd.github+json',
        ...(bodyStr !== undefined ? { 'Content-Type': 'application/json' } : {})
      },
      body: bodyStr,
      ignoreTls,
      signal
    })
    const data = parseJson(res)
    if (res.status >= 400) {
      const base = statusText[res.status] ?? `请求失败（HTTP ${res.status}）`
      const msg = githubMessage(data)
      return { ok: false, status: res.status, error: msg ? `${base}：${msg}` : base }
    }
    return { ok: true, data, total: null }
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    if (signal?.aborted || err.name === 'AbortError') return { ok: false, status: 0, error: '已取消' }
    return { ok: false, status: 0, error: networkError(err) }
  }
}

function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' }
}

/** 将常见 GitLab 风格路径映射到 GitHub，并规范化响应形状 */
export async function githubRequest<T = unknown>(req: ApiRequest): Promise<ApiResult<T>> {
  const cfg = getConfig()
  const auth = await getValidAuth()
  if (!cfg.baseUrl || !auth || auth.type !== 'pat') return { ok: false, status: 401, error: '尚未登录' }
  if (!safeApiPath(req.path)) return { ok: false, status: 0, error: '非法的 API 路径' }

  let apiRoot: string
  try {
    apiRoot = githubApiRoot(cfg.baseUrl)
  } catch {
    return { ok: false, status: 0, error: 'GitHub 地址格式不正确' }
  }

  const headers = authHeader(auth.token)
  const method = (req.method || 'GET').toUpperCase()
  const path = req.path
  const query = req.query || {}

  // ---- /user ----
  if (path === '/user' && method === 'GET') {
    const r = await rawGet(apiRoot, headers, cfg.ignoreTls, '/user')
    if (!r.ok) return r
    const u = r.data as GhUser
    return { ok: true, data: { ...mapUser(u), is_admin: false } as T, total: null }
  }

  // ---- /users（搜索，供添加成员等）----
  if (path === '/users' && method === 'GET') {
    const search = q(query, 'search') || q(query, 'username') || ''
    if (!search) return { ok: true, data: [] as T, total: 0 }
    const r = await rawGet(apiRoot, headers, cfg.ignoreTls, '/search/users', undefined, {
      q: search,
      per_page: q(query, 'per_page') || '20',
      page: q(query, 'page') || '1'
    })
    if (!r.ok) return r
    const items = ((r.data as { items?: GhUser[] }).items || []).map((u) => mapUser(u))
    return { ok: true, data: items as T, total: (r.data as { total_count?: number }).total_count ?? items.length }
  }

  // ---- /groups（个人所属组织，供新建仓库选归属）----
  if (path === '/groups' && method === 'GET') {
    const r = await rawGet(apiRoot, headers, cfg.ignoreTls, '/user/orgs', undefined, {
      per_page: q(query, 'per_page') || '50',
      page: q(query, 'page') || '1'
    })
    if (!r.ok) return r
    const search = (q(query, 'search') || '').toLowerCase()
    let orgs = (r.data as { id: number; login: string; description?: string | null }[]).map((o) => ({
      id: o.id,
      name: o.login,
      path: o.login,
      full_name: o.login,
      full_path: o.login,
      parent_id: null,
      web_url: `https://github.com/${o.login}`,
      description: o.description
    }))
    if (search) orgs = orgs.filter((o) => o.full_path.toLowerCase().includes(search))
    return { ok: true, data: orgs as T, total: r.total }
  }

  const oneGroup = /^\/groups\/(\d+)$/.exec(path)
  if (oneGroup && method === 'GET') {
    const id = Number(oneGroup[1])
    const r = await rawGet(apiRoot, headers, cfg.ignoreTls, '/user/orgs', undefined, { per_page: '100' })
    if (!r.ok) return r
    const o = (r.data as { id: number; login: string }[]).find((x) => x.id === id)
    if (!o) return { ok: false, status: 404, error: '组织不存在，或你没有访问权限' }
    return {
      ok: true,
      data: {
        id: o.id,
        name: o.login,
        path: o.login,
        full_name: o.login,
        full_path: o.login,
        parent_id: null,
        web_url: `https://github.com/${o.login}`
      } as T,
      total: null
    }
  }

  // ---- /projects ----
  if (path === '/projects' && method === 'GET') {
    const page = q(query, 'page') || '1'
    const perPage = q(query, 'per_page') || '20'
    const search = q(query, 'search')
    const r = await rawGet(apiRoot, headers, cfg.ignoreTls, '/user/repos', undefined, {
      page,
      per_page: perPage,
      sort: 'updated',
      affiliation: 'owner,collaborator,organization_member',
      ...(search ? { type: 'all' } : {})
    })
    if (!r.ok) return r
    let list = (r.data as GhRepo[]).map((repo) => {
      repoCache.set(repo.id, repo.full_name)
      return mapRepo(repo)
    })
    if (search) {
      const s = search.toLowerCase()
      list = list.filter((p) => p.path_with_namespace.toLowerCase().includes(s) || p.name.toLowerCase().includes(s))
    }
    return { ok: true, data: list as T, total: r.total }
  }

  if (path === '/projects' && method === 'POST') {
    const body = req.body as {
      name: string
      path?: string
      description?: string
      visibility?: string
      namespace_id?: number
      initialize_with_readme?: boolean
    }
    const name = (body.path || body.name || '').trim()
    if (!name) return { ok: false, status: 400, error: '请填写仓库名称' }
    const payload = {
      name,
      description: body.description || undefined,
      private: body.visibility !== 'public',
      auto_init: Boolean(body.initialize_with_readme)
    }
    let createPath = '/user/repos'
    if (body.namespace_id) {
      const orgs = await rawGet(apiRoot, headers, cfg.ignoreTls, '/user/orgs', undefined, { per_page: '100' })
      if (!orgs.ok) return orgs
      const org = (orgs.data as { id: number; login: string }[]).find((o) => o.id === body.namespace_id)
      if (!org) return { ok: false, status: 404, error: '找不到对应的组织，或你没有在该组织下建仓的权限' }
      createPath = `/orgs/${org.login}/repos`
    }
    const r = await rawSend(apiRoot, headers, cfg.ignoreTls, 'POST', createPath, payload)
    if (!r.ok) return r
    const repo = r.data as GhRepo
    repoCache.set(repo.id, repo.full_name)
    return { ok: true, data: mapRepo(repo) as T, total: null }
  }

  // ---- /projects/:id... ----
  const projectMatch = /^\/projects\/([^/]+)(?:\/(.*))?$/.exec(path)
  if (projectMatch) {
    const projectKey = decodeURIComponent(projectMatch[1])
    const rest = projectMatch[2] || ''
    const resolved = await resolveFullName(apiRoot, headers, cfg.ignoreTls, projectKey)
    if (!resolved) return { ok: false, status: 404, error: '仓库不存在，或你没有访问权限' }
    const { id: projectId, full_name } = resolved
    const repoPath = `/repos/${full_name}`

    if (!rest && method === 'GET') {
      const r = await rawGet(apiRoot, headers, cfg.ignoreTls, repoPath)
      if (!r.ok) return r
      return { ok: true, data: mapRepo(r.data as GhRepo) as T, total: null }
    }

    // members / collaborators
    const ghPermToLevel = (p?: { admin?: boolean; maintain?: boolean; push?: boolean; triage?: boolean; pull?: boolean }): number => {
      if (!p) return 10
      if (p.admin) return 50
      if (p.maintain) return 40
      if (p.push) return 30
      if (p.triage) return 20
      return 10
    }
    const levelToGhPerm = (level: number): string => {
      if (level >= 50) return 'admin'
      if (level >= 40) return 'maintain'
      if (level >= 30) return 'push'
      if (level >= 20) return 'triage'
      return 'pull'
    }
    const mapCollaborator = (c: {
      id: number
      login: string
      name?: string | null
      permissions?: { admin?: boolean; maintain?: boolean; push?: boolean; triage?: boolean; pull?: boolean }
      role_name?: string
    }) => ({
      id: c.id,
      username: c.login,
      name: c.name || c.login,
      access_level: c.role_name === 'admin' ? 50 : ghPermToLevel(c.permissions),
      state: 'active',
      expires_at: null
    })

    const resolveLogin = async (userId: string): Promise<string | null> => {
      if (!/^\d+$/.test(userId)) return userId
      const u = await rawGet(apiRoot, headers, cfg.ignoreTls, `/users/${userId}`)
      if (!u.ok) return null
      return (u.data as { login?: string }).login || null
    }

    if (rest === 'members' && method === 'GET') {
      const r = await rawGet(apiRoot, headers, cfg.ignoreTls, `${repoPath}/collaborators`, undefined, {
        affiliation: 'all',
        per_page: q(query, 'per_page') || '100',
        page: q(query, 'page') || '1'
      })
      if (!r.ok) return r
      return { ok: true, data: (r.data as Parameters<typeof mapCollaborator>[0][]).map(mapCollaborator) as T, total: r.total }
    }

    if (rest === 'members' && method === 'POST') {
      const body = req.body as { user_id?: number; username?: string; access_level?: number }
      let login = body.username?.trim()
      if (!login && body.user_id) login = (await resolveLogin(String(body.user_id))) || undefined
      if (!login) return { ok: false, status: 400, error: '请填写要添加的 GitHub 用户名' }
      const r = await rawSend(apiRoot, headers, cfg.ignoreTls, 'PUT', `${repoPath}/collaborators/${encodeURIComponent(login)}`, {
        permission: levelToGhPerm(body.access_level ?? 30)
      })
      if (!r.ok) return r
      // 邀请可能无立即返回用户体；再拉一次协作者或用户信息
      const u = await rawGet(apiRoot, headers, cfg.ignoreTls, `/users/${encodeURIComponent(login)}`)
      if (u.ok) {
        const user = u.data as { id: number; login: string; name?: string | null }
        return {
          ok: true,
          data: {
            id: user.id,
            username: user.login,
            name: user.name || user.login,
            access_level: body.access_level ?? 30,
            state: 'active',
            expires_at: null
          } as T,
          total: null
        }
      }
      return { ok: true, data: { id: 0, username: login, name: login, access_level: body.access_level ?? 30, state: 'active' } as T, total: null }
    }

    const memberMatch = /^members\/([^/]+)$/.exec(rest)
    if (memberMatch) {
      const key = decodeURIComponent(memberMatch[1])
      const login = await resolveLogin(key)
      if (!login) return { ok: false, status: 404, error: '找不到该用户' }
      if (method === 'PUT') {
        const body = req.body as { access_level?: number }
        const r = await rawSend(apiRoot, headers, cfg.ignoreTls, 'PUT', `${repoPath}/collaborators/${encodeURIComponent(login)}`, {
          permission: levelToGhPerm(body.access_level ?? 30)
        })
        if (!r.ok) return r
        return {
          ok: true,
          data: { id: Number(key) || 0, username: login, name: login, access_level: body.access_level ?? 30, state: 'active' } as T,
          total: null
        }
      }
      if (method === 'DELETE') {
        const r = await rawSend(apiRoot, headers, cfg.ignoreTls, 'DELETE', `${repoPath}/collaborators/${encodeURIComponent(login)}`)
        if (!r.ok) return r
        return { ok: true, data: null as T, total: null }
      }
    }

    // branches
    if (rest === 'repository/branches' && method === 'GET') {
      const page = q(query, 'page') || '1'
      const perPage = q(query, 'per_page') || '100'
      const search = q(query, 'search')
      const r = await rawGet(apiRoot, headers, cfg.ignoreTls, `${repoPath}/branches`, undefined, { page, per_page: perPage })
      if (!r.ok) return r
      const repo = await rawGet(apiRoot, headers, cfg.ignoreTls, repoPath)
      const def = repo.ok ? (repo.data as GhRepo).default_branch : undefined
      let list = (r.data as GhBranch[]).map((b) => mapBranch(b, def))
      if (search) list = list.filter((b) => b.name.toLowerCase().includes(search.toLowerCase()))
      return { ok: true, data: list as T, total: r.total }
    }

    const oneBranch = /^repository\/branches\/(.+)$/.exec(rest)
    if (oneBranch && method === 'GET') {
      const name = decodeURIComponent(oneBranch[1])
      const r = await rawGet(apiRoot, headers, cfg.ignoreTls, `${repoPath}/branches/${encodeURIComponent(name)}`)
      if (!r.ok) return r
      const repo = await rawGet(apiRoot, headers, cfg.ignoreTls, repoPath)
      const def = repo.ok ? (repo.data as GhRepo).default_branch : undefined
      return { ok: true, data: mapBranch(r.data as GhBranch, def) as T, total: null }
    }

    // tree
    if (rest === 'repository/tree' && method === 'GET') {
      const ref = q(query, 'ref') || 'HEAD'
      const treePath = q(query, 'path') || ''
      const contentPath = treePath
        ? `${repoPath}/contents/${treePath.split('/').filter(Boolean).map(encodeURIComponent).join('/')}`
        : `${repoPath}/contents`
      const r = await rawGet(apiRoot, headers, cfg.ignoreTls, contentPath, undefined, { ref })
      if (!r.ok) return r
      const items = Array.isArray(r.data) ? r.data : [r.data]
      const mapped = (items as { sha: string; name: string; type: string; path: string; size?: number }[]).map((it) => ({
        id: it.sha,
        name: it.name,
        type: it.type === 'dir' ? 'tree' : 'blob',
        path: it.path,
        mode: '100644'
      }))
      return { ok: true, data: mapped as T, total: null }
    }

    // file
    if (rest === 'repository/files/' || rest.startsWith('repository/files/')) {
      // GitLab: /repository/files/:path?ref=
      const filePath = decodeURIComponent(rest.replace(/^repository\/files\//, '').replace(/\/raw$/, ''))
      const ref = q(query, 'ref') || 'HEAD'
      if (method === 'GET') {
        const r = await rawGet(
          apiRoot,
          headers,
          cfg.ignoreTls,
          `${repoPath}/contents/${filePath.split('/').map(encodeURIComponent).join('/')}`,
          undefined,
          { ref }
        )
        if (!r.ok) return r
        const f = r.data as { name: string; path: string; size: number; encoding?: string; content?: string; download_url?: string }
        if (req.raw || rest.endsWith('/raw')) {
          if (f.encoding === 'base64' && f.content) {
            return { ok: true, data: Buffer.from(f.content.replace(/\n/g, ''), 'base64').toString('utf8') as T, total: null }
          }
          return { ok: false, status: 404, error: '无法读取文件内容' }
        }
        return {
          ok: true,
          data: {
            file_name: f.name,
            file_path: f.path,
            size: f.size,
            encoding: f.encoding || 'base64',
            content: f.content || ''
          } as T,
          total: null
        }
      }
    }

    // commits
    if (rest === 'repository/commits' && method === 'GET') {
      const page = q(query, 'page') || '1'
      const perPage = q(query, 'per_page') || '30'
      const sha = q(query, 'ref_name') || q(query, 'ref')
      const pathFilter = q(query, 'path')
      const r = await rawGet(apiRoot, headers, cfg.ignoreTls, `${repoPath}/commits`, undefined, {
        page,
        per_page: perPage,
        ...(sha ? { sha } : {}),
        ...(pathFilter ? { path: pathFilter } : {})
      })
      if (!r.ok) return r
      return { ok: true, data: (r.data as GhCommit[]).map(mapCommit) as T, total: r.total }
    }

    const oneCommit = /^repository\/commits\/([^/]+)(?:\/(diff|statuses))?$/.exec(rest)
    if (oneCommit && method === 'GET') {
      const sha = decodeURIComponent(oneCommit[1])
      if (oneCommit[2] === 'diff') {
        const r = await rawGet(apiRoot, headers, cfg.ignoreTls, `${repoPath}/commits/${sha}`)
        if (!r.ok) return r
        const files = ((r.data as { files?: { filename: string; status: string; patch?: string; previous_filename?: string }[] }).files ||
          []) as { filename: string; status: string; patch?: string; previous_filename?: string }[]
        const diffs = files.map((f) => ({
          old_path: f.previous_filename || f.filename,
          new_path: f.filename,
          diff: f.patch || '',
          new_file: f.status === 'added',
          deleted_file: f.status === 'removed',
          renamed_file: f.status === 'renamed'
        }))
        return { ok: true, data: diffs as T, total: null }
      }
      const r = await rawGet(apiRoot, headers, cfg.ignoreTls, `${repoPath}/commits/${sha}`)
      if (!r.ok) return r
      return { ok: true, data: mapCommit(r.data as GhCommit) as T, total: null }
    }

    // tags
    if (rest === 'repository/tags' && method === 'GET') {
      const r = await rawGet(apiRoot, headers, cfg.ignoreTls, `${repoPath}/tags`, undefined, {
        page: q(query, 'page') || '1',
        per_page: q(query, 'per_page') || '50'
      })
      if (!r.ok) return r
      const tags = (r.data as { name: string; commit: { sha: string } }[]).map((t) => ({
        name: t.name,
        message: null,
        commit: { id: t.commit.sha, short_id: t.commit.sha.slice(0, 8), title: '', message: '', author_name: '', author_email: '', created_at: '', committed_date: '' }
      }))
      return { ok: true, data: tags as T, total: r.total }
    }

    // issues
    if (rest === 'issues' && method === 'GET') {
      const state = q(query, 'state')
      const ghState = state === 'opened' ? 'open' : state === 'closed' ? 'closed' : 'all'
      const r = await rawGet(apiRoot, headers, cfg.ignoreTls, `${repoPath}/issues`, undefined, {
        state: ghState,
        page: q(query, 'page') || '1',
        per_page: q(query, 'per_page') || '20',
        ...(q(query, 'search') ? { labels: '' } : {})
      })
      if (!r.ok) return r
      let list = (r.data as GhIssue[]).filter((i) => !i.pull_request).map((i) => mapIssue(i, projectId, full_name))
      const search = q(query, 'search')
      if (search) list = list.filter((i) => i.title.toLowerCase().includes(search.toLowerCase()))
      return { ok: true, data: list as T, total: r.total }
    }

    if (rest === 'issues' && method === 'POST') {
      const body = req.body as { title: string; description?: string; labels?: string }
      const r = await rawSend(apiRoot, headers, cfg.ignoreTls, 'POST', `${repoPath}/issues`, {
        title: body.title,
        body: body.description,
        labels: body.labels ? body.labels.split(',').map((x) => x.trim()).filter(Boolean) : undefined
      })
      if (!r.ok) return r
      return { ok: true, data: mapIssue(r.data as GhIssue, projectId, full_name) as T, total: null }
    }

    const issueMatch = /^issues\/(\d+)(?:\/(notes))?$/.exec(rest)
    if (issueMatch) {
      const num = issueMatch[1]
      if (issueMatch[2] === 'notes' && method === 'GET') {
        const r = await rawGet(apiRoot, headers, cfg.ignoreTls, `${repoPath}/issues/${num}/comments`, undefined, {
          page: q(query, 'page') || '1',
          per_page: q(query, 'per_page') || '100'
        })
        if (!r.ok) return r
        return { ok: true, data: (r.data as GhComment[]).map(mapNote) as T, total: r.total }
      }
      if (issueMatch[2] === 'notes' && method === 'POST') {
        const body = req.body as { body: string }
        const r = await rawSend(apiRoot, headers, cfg.ignoreTls, 'POST', `${repoPath}/issues/${num}/comments`, { body: body.body })
        if (!r.ok) return r
        return { ok: true, data: mapNote(r.data as GhComment) as T, total: null }
      }
      if (method === 'GET') {
        const r = await rawGet(apiRoot, headers, cfg.ignoreTls, `${repoPath}/issues/${num}`)
        if (!r.ok) return r
        return { ok: true, data: mapIssue(r.data as GhIssue, projectId, full_name) as T, total: null }
      }
      if (method === 'PUT') {
        const body = req.body as { state_event?: string; title?: string; description?: string }
        const r = await rawSend(apiRoot, headers, cfg.ignoreTls, 'PATCH', `${repoPath}/issues/${num}`, {
          title: body.title,
          body: body.description,
          state: body.state_event === 'close' ? 'closed' : body.state_event === 'reopen' ? 'open' : undefined
        })
        if (!r.ok) return r
        return { ok: true, data: mapIssue(r.data as GhIssue, projectId, full_name) as T, total: null }
      }
    }

    // merge_requests -> pulls
    if (rest === 'merge_requests' && method === 'GET') {
      const state = q(query, 'state')
      const ghState = state === 'opened' ? 'open' : state === 'closed' || state === 'merged' ? 'closed' : 'all'
      const r = await rawGet(apiRoot, headers, cfg.ignoreTls, `${repoPath}/pulls`, undefined, {
        state: ghState,
        page: q(query, 'page') || '1',
        per_page: q(query, 'per_page') || '20',
        sort: 'updated',
        direction: 'desc'
      })
      if (!r.ok) return r
      let list = (r.data as GhPr[]).map((p) => mapPr(p, projectId, full_name))
      if (state === 'merged') list = list.filter((p) => p.state === 'merged')
      if (state === 'closed') list = list.filter((p) => p.state === 'closed')
      const search = q(query, 'search')
      if (search) list = list.filter((p) => p.title.toLowerCase().includes(search.toLowerCase()))
      return { ok: true, data: list as T, total: r.total }
    }

    if (rest === 'merge_requests' && method === 'POST') {
      const body = req.body as {
        source_branch: string
        target_branch: string
        title: string
        description?: string
        draft?: boolean
      }
      const title = body.title
      const r = await rawSend(apiRoot, headers, cfg.ignoreTls, 'POST', `${repoPath}/pulls`, {
        head: body.source_branch,
        base: body.target_branch,
        title,
        body: body.description,
        draft: body.draft || /^Draft:/i.test(title)
      })
      if (!r.ok) return r
      return { ok: true, data: mapPr(r.data as GhPr, projectId, full_name) as T, total: null }
    }

    const mrMatch = /^merge_requests\/(\d+)(?:\/(notes|diffs|changes|merge|approvals|approve|unapprove|discussions))?$/.exec(rest)
    if (mrMatch) {
      const num = mrMatch[1]
      const sub = mrMatch[2]
      if (!sub && method === 'GET') {
        const r = await rawGet(apiRoot, headers, cfg.ignoreTls, `${repoPath}/pulls/${num}`)
        if (!r.ok) return r
        return { ok: true, data: mapPr(r.data as GhPr, projectId, full_name) as T, total: null }
      }
      if (!sub && method === 'PUT') {
        const body = req.body as { state_event?: string; title?: string; description?: string }
        const r = await rawSend(apiRoot, headers, cfg.ignoreTls, 'PATCH', `${repoPath}/pulls/${num}`, {
          title: body.title,
          body: body.description,
          state: body.state_event === 'close' ? 'closed' : body.state_event === 'reopen' ? 'open' : undefined
        })
        if (!r.ok) return r
        return { ok: true, data: mapPr(r.data as GhPr, projectId, full_name) as T, total: null }
      }
      if (sub === 'merge' && method === 'PUT') {
        const body = req.body as { squash?: boolean }
        const r = await rawSend(apiRoot, headers, cfg.ignoreTls, 'PUT', `${repoPath}/pulls/${num}/merge`, {
          merge_method: body.squash ? 'squash' : 'merge'
        })
        if (!r.ok) return r
        return { ok: true, data: mapPr(r.data as GhPr, projectId, full_name) as T, total: null }
      }
      if ((sub === 'diffs' || sub === 'changes') && method === 'GET') {
        const r = await rawGet(apiRoot, headers, cfg.ignoreTls, `${repoPath}/pulls/${num}/files`)
        if (!r.ok) return r
        const files = r.data as { filename: string; status: string; patch?: string; previous_filename?: string }[]
        const diffs = files.map((f) => ({
          old_path: f.previous_filename || f.filename,
          new_path: f.filename,
          diff: f.patch || '',
          new_file: f.status === 'added',
          deleted_file: f.status === 'removed',
          renamed_file: f.status === 'renamed'
        }))
        if (sub === 'changes') return { ok: true, data: { changes: diffs } as T, total: null }
        return { ok: true, data: diffs as T, total: null }
      }
      if (sub === 'notes' && method === 'GET') {
        const r = await rawGet(apiRoot, headers, cfg.ignoreTls, `${repoPath}/issues/${num}/comments`, undefined, {
          page: q(query, 'page') || '1',
          per_page: q(query, 'per_page') || '100'
        })
        if (!r.ok) return r
        return { ok: true, data: (r.data as GhComment[]).map(mapNote) as T, total: r.total }
      }
      if (sub === 'notes' && method === 'POST') {
        const body = req.body as { body: string }
        const r = await rawSend(apiRoot, headers, cfg.ignoreTls, 'POST', `${repoPath}/issues/${num}/comments`, { body: body.body })
        if (!r.ok) return r
        return { ok: true, data: mapNote(r.data as GhComment) as T, total: null }
      }
      if (sub === 'discussions' && method === 'GET') {
        // 简化：issue comments 作为独立讨论
        const r = await rawGet(apiRoot, headers, cfg.ignoreTls, `${repoPath}/issues/${num}/comments`, undefined, {
          per_page: '100'
        })
        if (!r.ok) return r
        const discussions = (r.data as GhComment[]).map((c) => ({
          id: String(c.id),
          individual_note: true,
          notes: [mapNote(c)]
        }))
        return { ok: true, data: discussions as T, total: null }
      }
      if (sub === 'discussions' && method === 'POST') {
        const body = req.body as { body: string }
        const r = await rawSend(apiRoot, headers, cfg.ignoreTls, 'POST', `${repoPath}/issues/${num}/comments`, { body: body.body })
        if (!r.ok) return r
        const note = mapNote(r.data as GhComment)
        return { ok: true, data: { id: String(note.id), individual_note: true, notes: [note] } as T, total: null }
      }
      if (sub === 'approvals' && method === 'GET') {
        return { ok: true, data: { approved_by: [] } as T, total: null }
      }
      if ((sub === 'approve' || sub === 'unapprove') && method === 'POST') {
        return { ok: false, status: 404, error: 'GitHub 不支持 GitLab 式批准接口，请在网页或用 Review 完成' }
      }
    }

    return { ok: false, status: 404, error: `当前 GitHub 模式暂不支持：${path}` }
  }

  // 全局 MR / Issue（无项目）
  if (path === '/merge_requests' && method === 'GET') {
    const r = await rawGet(apiRoot, headers, cfg.ignoreTls, '/search/issues', undefined, {
      q: 'is:pr is:open author:@me',
      page: q(query, 'page') || '1',
      per_page: q(query, 'per_page') || '20'
    })
    // search API 结构不同，退化为 user repos 的 PR 聚合太重；用 pulls 搜索
    if (!r.ok) {
      // fallback: empty
      return { ok: true, data: [] as T, total: 0 }
    }
    // GitHub search issues returns items
    const items = ((r.data as { items?: GhIssue[] }).items || []).filter((i) => i.pull_request)
    // Need full PR for branches — return issue-shaped mapped as thin PR
    const list = items.map((i) => {
      const full = i.html_url.replace('https://github.com/', '').replace(/\/pull\/\d+$/, '')
      return {
        id: i.id,
        iid: i.number,
        number: i.number,
        project_id: 0,
        title: i.title,
        description: i.body,
        state: 'opened',
        author: mapUser(i.user),
        assignees: (i.assignees || []).map(mapUser),
        source_branch: '',
        target_branch: '',
        web_url: i.html_url,
        created_at: i.created_at,
        updated_at: i.updated_at,
        has_conflicts: false,
        references: { full: `${full}#${i.number}` },
        user_notes_count: i.comments
      }
    })
    return { ok: true, data: list as T, total: (r.data as { total_count?: number }).total_count ?? list.length }
  }

  if (path === '/issues' && method === 'GET') {
    const r = await rawGet(apiRoot, headers, cfg.ignoreTls, '/user/issues', undefined, {
      filter: 'all',
      state: q(query, 'state') === 'closed' ? 'closed' : q(query, 'state') === 'all' ? 'all' : 'open',
      page: q(query, 'page') || '1',
      per_page: q(query, 'per_page') || '20'
    })
    if (!r.ok) return r
    const list = (r.data as GhIssue[])
      .filter((i) => !i.pull_request)
      .map((i) => {
        const full = i.html_url.replace('https://github.com/', '').replace(/\/issues\/\d+$/, '')
        return mapIssue(i, 0, full)
      })
    return { ok: true, data: list as T, total: r.total }
  }

  return { ok: false, status: 404, error: `当前 GitHub 模式暂不支持：${path}` }
}
