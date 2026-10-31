import { useEffect, useMemo, useState } from 'react'
import { Button, Card, Input, Segmented, Select, Space, Table, Tag, Typography } from 'antd'
import { StarFilled, StarOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { get, getAll, getPage, openExternal, post, useAction } from '../api'
import CreateProjectModal from '../components/CreateProjectModal'
import { TimeAgo, mrLabel, visibilityText } from '../labels'
import type { Group, Project } from '../types'

type Scope = 'membership' | 'starred' | 'all'

type ProjectRow = Project & { namespace?: { id: number; name: string; full_path: string; kind: 'group' | 'user' } }

function useDebounced<T>(value: T, delay = 300): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return v
}

function GroupSelect({ value, onChange }: { value?: number; onChange: (v?: number) => void }) {
  const [input, setInput] = useState('')
  const search = useDebounced(input)

  const list = useQuery({
    queryKey: ['group-options', search],
    queryFn: ({ signal }) => get<Group[]>('/groups', { search, all_available: true, order_by: 'name', per_page: 50 }, signal)
  })
  const current = useQuery({
    queryKey: ['group', value],
    queryFn: ({ signal }) => get<Group>(`/groups/${value}`, { with_projects: false }, signal),
    enabled: value != null && !list.data?.some((g) => g.id === value)
  })

  const options = useMemo(() => {
    const items = [...(list.data ?? [])]
    if (current.data && !items.some((g) => g.id === current.data.id)) items.unshift(current.data)
    return items.map((g) => ({ value: g.id, label: g.full_path, title: g.full_name }))
  }, [list.data, current.data])

  return (
    <Select
      showSearch
      allowClear
      value={value}
      placeholder="全部组"
      style={{ width: 220 }}
      filterOption={false}
      onSearch={setInput}
      onChange={(v) => {
        setInput('')
        onChange(v ?? undefined)
      }}
      loading={list.isFetching}
      options={options}
      notFoundContent={list.isFetching ? '加载中…' : '没有匹配的组'}
    />
  )
}

export default function ProjectsPage() {
  const navigate = useNavigate()
  const run = useAction()
  const cfg = useQuery({ queryKey: ['config'], queryFn: () => window.desktop.getConfig() })
  const isGithub = cfg.data?.provider === 'github'
  const caps = cfg.data?.capabilities
  const mrText = mrLabel(cfg.data?.provider || 'gitlab')
  const [params, setParams] = useSearchParams()
  const group = isGithub ? undefined : Number(params.get('group')) || undefined
  const [scope, setScope] = useState<Scope>('membership')
  const [input, setInput] = useState('')
  const search = useDebounced(input.trim())
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [creating, setCreating] = useState(false)

  useEffect(() => setPage(1), [search])

  const setGroup = (id?: number) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (id) next.set('group', String(id))
        else next.delete('group')
        return next
      },
      { replace: true }
    )
    setPage(1)
  }

  const projects = useQuery({
    queryKey: ['projects', scope, group, search, page, pageSize],
    queryFn: ({ signal }) =>
      group
        ? getPage<ProjectRow>(`/groups/${group}/projects`, {
            include_subgroups: true,
            min_access_level: scope === 'membership' ? 10 : undefined,
            starred: scope === 'starred' || undefined,
            search: search || undefined,
            order_by: 'last_activity_at',
            page,
            per_page: pageSize
          }, signal)
        : getPage<ProjectRow>('/projects', {
            membership: scope === 'membership' || undefined,
            starred: scope === 'starred' || undefined,
            search: search || undefined,
            search_namespaces: search ? true : undefined,
            order_by: 'last_activity_at',
            page,
            per_page: pageSize
          }, signal)
  })
  const starred = useQuery({
    queryKey: ['starred-ids'],
    queryFn: async ({ signal }) => new Set((await getAll<Project>('/projects', { starred: true, simple: true }, undefined, signal)).map((p) => p.id)),
    enabled: !isGithub
  })

  const toggleStar = (p: Project) => {
    const isStarred = starred.data?.has(p.id)
    void run(
      () => post(`/projects/${p.id}/${isStarred ? 'unstar' : 'star'}`),
      isStarred ? '已取消星标' : '已加星标',
      [['starred-ids'], ['projects']]
    )
  }

  const renderName = (p: ProjectRow) => {
    const i = p.name_with_namespace.lastIndexOf(' / ')
    const ns = p.namespace
    if (i < 0 || ns?.kind !== 'group') return <a onClick={() => navigate(`/projects/${p.id}`)}>{p.name_with_namespace}</a>
    return (
      <span>
        <a title={`按组「${ns.full_path}」筛选`} onClick={() => setGroup(ns.id)}>
          {p.name_with_namespace.slice(0, i)}
        </a>
        {' / '}
        <a onClick={() => navigate(`/projects/${p.id}`)}>{p.name_with_namespace.slice(i + 3)}</a>
      </span>
    )
  }

  const noun = isGithub ? '仓库' : '项目'

  return (
    <Card
      title={noun}
      extra={
        <Space wrap>
          <Button type="primary" onClick={() => setCreating(true)}>
            新建{noun}
          </Button>
          {!isGithub && (
            <Segmented<Scope>
              value={scope}
              onChange={(v) => {
                setScope(v)
                setPage(1)
              }}
              options={[
                { label: '我参与的', value: 'membership' },
                { label: '我星标的', value: 'starred' },
                { label: '全部可见', value: 'all' }
              ]}
            />
          )}
          {!isGithub && <GroupSelect value={group} onChange={setGroup} />}
          <Input.Search
            allowClear
            placeholder={isGithub ? '搜索仓库名' : '搜索项目名或组名'}
            style={{ width: 240 }}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onSearch={(v) => setInput(v)}
          />
        </Space>
      }
    >
      <Table<ProjectRow>
        rowKey="id"
        loading={projects.isLoading}
        dataSource={projects.data?.data}
        onRow={(p) => ({ onDoubleClick: () => navigate(`/projects/${p.id}`) })}
        pagination={{
          current: page,
          pageSize,
          total: projects.data?.total ?? undefined,
          showTotal: (n) => (projects.data?.total == null ? `本页 ${projects.data?.data.length ?? 0} 个${noun}` : `共 ${n} 个${noun}`),
          onChange: (p, s) => {
            setPage(p)
            setPageSize(s)
          }
        }}
        columns={[
          !isGithub
            ? {
                title: '',
                width: 40,
                render: (_: unknown, p: ProjectRow) =>
                  starred.data?.has(p.id) ? (
                    <StarFilled className="clickable" style={{ color: '#faad14' }} onClick={() => toggleStar(p)} />
                  ) : (
                    <StarOutlined className="clickable" onClick={() => toggleStar(p)} />
                  )
              }
            : null,
          {
            title: noun,
            render: (_: unknown, p: ProjectRow) => (
              <div>
                {isGithub ? (
                  <a onClick={() => navigate(`/projects/${p.id}`)}>{p.path_with_namespace}</a>
                ) : (
                  renderName(p)
                )}
                {p.description && (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }} ellipsis>
                    {p.description}
                  </Typography.Text>
                )}
              </div>
            )
          },
          { title: '可见性', width: 80, render: (_: unknown, p: ProjectRow) => (p.visibility ? <Tag>{visibilityText[p.visibility] ?? p.visibility}</Tag> : '-') },
          { title: '默认分支', width: 120, dataIndex: 'default_branch' },
          { title: '星标', width: 70, dataIndex: 'star_count' },
          { title: '最后活动', width: 110, dataIndex: 'last_activity_at', render: (v: string) => <TimeAgo value={v} /> },
          {
            title: '操作',
            width: isGithub ? 220 : 300,
            render: (_: unknown, p: ProjectRow) => (
              <Space>
                <a onClick={() => navigate(`/projects/${p.id}`)}>代码</a>
                <a onClick={() => navigate(`/mrs?project=${p.id}`)}>{mrText}</a>
                <a onClick={() => navigate(`/issues?project=${p.id}`)}>Issue</a>
                {caps?.pipelines && <a onClick={() => navigate(`/pipelines?project=${p.id}`)}>流水线</a>}
                <a onClick={() => openExternal(p.web_url)}>网页</a>
              </Space>
            )
          }
        ].filter(Boolean) as Parameters<typeof Table<ProjectRow>>[0]['columns']}
      />
      <CreateProjectModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(p) => navigate(`/projects/${p.id}`)}
      />
    </Card>
  )
}
