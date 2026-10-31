import { useEffect, useMemo, useState } from 'react'
import { Empty, Input, Modal, Spin, Typography } from 'antd'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { get, getPage } from '../api'
import { mrLabel } from '../labels'
import type { Issue, MergeRequest, Project, Todo } from '../types'

export type PaletteOpenTarget =
  | { type: 'mr'; projectId: number; iid: number }
  | { type: 'issue'; projectId: number; iid: number }

type Item =
  | { key: string; kind: 'nav'; title: string; hint: string; path: string }
  | { key: string; kind: 'project'; title: string; hint: string; projectId: number }
  | { key: string; kind: 'mr'; title: string; hint: string; projectId: number; iid: number }
  | { key: string; kind: 'issue'; title: string; hint: string; projectId: number; iid: number }
  | { key: string; kind: 'todo'; title: string; hint: string; path: string }

const kindLabelBase: Record<Item['kind'], string> = {
  nav: '页面',
  project: '项目',
  mr: '合并请求',
  issue: 'Issue',
  todo: '待办'
}

export default function CommandPalette({
  open,
  onClose,
  onOpen
}: {
  open: boolean
  onClose: () => void
  onOpen: (target: PaletteOpenTarget) => void
}) {
  const navigate = useNavigate()
  const cfg = useQuery({ queryKey: ['config'], queryFn: () => window.desktop.getConfig(), enabled: open })
  const caps = cfg.data?.capabilities
  const provider = cfg.data?.provider || 'gitlab'
  const mrText = mrLabel(provider)
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(0)
  const [remote, setRemote] = useState<Item[]>([])

  const nav = useMemo((): Item[] => {
    const all: Item[] = [
      { key: 'nav-home', kind: 'nav', title: '工作台', hint: '首页', path: '/' },
      { key: 'nav-todos', kind: 'nav', title: '待办', hint: '待办列表', path: '/todos' },
      {
        key: 'nav-projects',
        kind: 'nav',
        title: provider === 'github' ? '仓库' : '项目',
        hint: provider === 'github' ? '仓库列表' : '项目列表',
        path: '/projects'
      },
      { key: 'nav-workspace', kind: 'nav', title: '本地仓库', hint: '本机 Git 工作区', path: '/workspace' },
      { key: 'nav-mrs', kind: 'nav', title: mrText, hint: provider === 'github' ? 'PR 列表' : 'MR 列表', path: '/mrs' },
      { key: 'nav-issues', kind: 'nav', title: 'Issue', hint: 'Issue 列表', path: '/issues' },
      { key: 'nav-pipelines', kind: 'nav', title: '流水线', hint: 'CI/CD', path: '/pipelines' },
      { key: 'nav-audit', kind: 'nav', title: '审计日志', hint: '谁拉取/推送了代码', path: '/audit' },
      { key: 'nav-users', kind: 'nav', title: '用户与权限', hint: '用户管理', path: '/users' },
      { key: 'nav-settings', kind: 'nav', title: '设置', hint: '账号与偏好', path: '/settings' }
    ]
    return all.filter((n) => {
      if (n.kind !== 'nav') return true
      if (n.path === '/todos') return caps?.todos !== false
      if (n.path === '/pipelines') return caps?.pipelines !== false
      if (n.path === '/audit') return caps?.audit !== false
      if (n.path === '/users') return caps?.adminUsers !== false
      return true
    })
  }, [caps, provider, mrText])

  const kindLabel = useMemo(
    () => ({
      ...kindLabelBase,
      project: provider === 'github' ? '仓库' : '项目',
      mr: mrText
    }),
    [provider, mrText]
  )

  useEffect(() => {
    if (!open) {
      setQ('')
      setRemote([])
      setActive(0)
      setLoading(false)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const text = q.trim()
    if (!text) {
      setRemote([])
      setLoading(false)
      return
    }
    const ac = new AbortController()
    setLoading(true)
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const [projects, mrs, issues, todos] = await Promise.all([
            getPage<Project>('/projects', { membership: true, search: text, per_page: 8, simple: true }, ac.signal),
            getPage<MergeRequest>('/merge_requests', { state: 'opened', scope: 'all', search: text, per_page: 8 }, ac.signal),
            getPage<Issue>('/issues', { state: 'opened', scope: 'all', search: text, per_page: 8 }, ac.signal),
            caps?.todos
              ? get<Todo[]>('/todos', { per_page: 50 }, ac.signal).catch(() => [] as Todo[])
              : Promise.resolve([] as Todo[])
          ])
          if (ac.signal.aborted) return
          const lower = text.toLowerCase()
          setRemote([
            ...projects.data.map((p) => ({
              key: `p-${p.id}`,
              kind: 'project' as const,
              title: p.name_with_namespace,
              hint: p.path_with_namespace,
              projectId: p.id
            })),
            ...mrs.data.map((m) => ({
              key: `mr-${m.project_id}-${m.iid}`,
              kind: 'mr' as const,
              title: m.title,
              hint: m.references.full,
              projectId: m.project_id,
              iid: m.iid
            })),
            ...issues.data.map((i) => ({
              key: `is-${i.project_id}-${i.iid}`,
              kind: 'issue' as const,
              title: i.title,
              hint: i.references.full,
              projectId: i.project_id,
              iid: i.iid
            })),
            ...todos
              .filter(
                (td) =>
                  td.body.toLowerCase().includes(lower) ||
                  (td.target?.title?.toLowerCase().includes(lower) ?? false) ||
                  (td.project?.name_with_namespace.toLowerCase().includes(lower) ?? false)
              )
              .slice(0, 8)
              .map((td) => ({
                key: `td-${td.id}`,
                kind: 'todo' as const,
                title: td.target?.title || td.body.slice(0, 80),
                hint: td.project?.name_with_namespace || td.action_name,
                path: '/todos'
              }))
          ])
          setActive(0)
        } catch {
          if (!ac.signal.aborted) setRemote([])
        } finally {
          if (!ac.signal.aborted) setLoading(false)
        }
      })()
    }, 280)
    return () => {
      ac.abort()
      window.clearTimeout(timer)
    }
  }, [q, open, caps?.todos])

  const items = useMemo(() => {
    const text = q.trim().toLowerCase()
    if (!text) return nav
    const navHit = nav.filter((n) => n.title.toLowerCase().includes(text) || n.hint.toLowerCase().includes(text))
    return [...navHit, ...remote]
  }, [q, remote, nav])

  const go = (item: Item) => {
    onClose()
    if (item.kind === 'nav' || item.kind === 'todo') navigate(item.path)
    else if (item.kind === 'project') navigate(`/projects/${item.projectId}`)
    else if (item.kind === 'mr') onOpen({ type: 'mr', projectId: item.projectId, iid: item.iid })
    else if (item.kind === 'issue') onOpen({ type: 'issue', projectId: item.projectId, iid: item.iid })
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActive((i) => Math.min(i + 1, Math.max(0, items.length - 1)))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActive((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter') {
        const item = items[active]
        if (!item) return
        e.preventDefault()
        go(item)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      closable={false}
      width={560}
      styles={{ body: { padding: 12 } }}
      destroyOnClose
    >
      <Input
        autoFocus
        size="large"
        placeholder={
          provider === 'github'
            ? `搜索仓库、${mrText}、Issue…`
            : caps?.todos === false
              ? `搜索项目、${mrText}、Issue…`
              : `搜索项目、${mrText}、Issue、待办…`
        }
        value={q}
        onChange={(e) => setQ(e.target.value)}
        allowClear
        suffix={loading ? <Spin size="small" /> : <Typography.Text type="secondary">Esc</Typography.Text>}
      />
      <div style={{ marginTop: 8, maxHeight: 360, overflow: 'auto' }}>
        {items.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={loading ? '搜索中…' : '没有匹配结果'} />
        ) : (
          items.map((item, i) => (
            <div
              key={item.key}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(item)}
              style={{
                padding: '8px 10px',
                borderRadius: 6,
                cursor: 'pointer',
                background: i === active ? '#e6f4ff' : undefined,
                display: 'flex',
                justifyContent: 'space-between',
                gap: 12
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 500 }}>{item.title}</div>
                <Typography.Text type="secondary" ellipsis style={{ fontSize: 12 }}>
                  {item.hint}
                </Typography.Text>
              </div>
              <Typography.Text type="secondary" style={{ flexShrink: 0, fontSize: 12 }}>
                {kindLabel[item.kind]}
              </Typography.Text>
            </div>
          ))
        )}
      </div>
    </Modal>
  )
}
