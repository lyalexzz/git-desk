import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Drawer,
  Empty,
  Input,
  Layout,
  List,
  Select,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
  Typography
} from 'antd'
import { FolderOpenOutlined, ReloadOutlined } from '@ant-design/icons'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { get } from '../api'
import { useGitEnv } from '../components/GitSshSettings'
import { TimeAgo } from '../labels'
import type { GitFileStatus, GitLocalCommit, OpenTarget, ScannedRepo, ScanResult } from '../../../shared/git'
import type { Project } from '../types'

const { Sider, Content } = Layout

type ListItem =
  | { key: string; kind: 'linked'; projectId: number; path: string; title: string }
  | { key: string; kind: 'unmatched'; path: string; title: string; remote: string | null; branch: string | null }

function statusLabel(f: GitFileStatus, area: 'staged' | 'unstaged' | 'untracked'): string {
  if (area === 'untracked') return '未跟踪'
  const code = area === 'staged' ? f.index : f.worktree
  const map: Record<string, string> = {
    M: '修改',
    A: '新增',
    D: '删除',
    R: '重命名',
    C: '复制',
    U: '冲突'
  }
  return map[code] || code
}

function LocalDiffView({ text }: { text: string }) {
  if (!text.trim()) return <Empty description="无差异" image={Empty.PRESENTED_IMAGE_SIMPLE} />
  return (
    <pre className="diff-view">
      {text.split('\n').map((line, i) => {
        const cls = line.startsWith('@@')
          ? 'diff-hunk'
          : line.startsWith('+') && !line.startsWith('+++')
            ? 'diff-add'
            : line.startsWith('-') && !line.startsWith('---')
              ? 'diff-del'
              : undefined
        return (
          <div key={i} className={cls}>
            {line || ' '}
          </div>
        )
      })}
    </pre>
  )
}

function LocalCommitsPanel({ projectId, branch }: { projectId: number; branch?: string }) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(30)
  const [sha, setSha] = useState<string>()
  const ref = branch && branch !== 'HEAD' ? branch : 'HEAD'

  const commits = useQuery({
    queryKey: ['git-log', projectId, ref, page, pageSize],
    queryFn: async () => {
      const r = await window.desktop.gitLog({
        projectId,
        ref,
        skip: (page - 1) * pageSize,
        limit: pageSize
      })
      if (!r.ok) throw new Error(r.error)
      return r.data
    }
  })

  const detail = useQuery({
    queryKey: ['git-show', projectId, sha],
    queryFn: async () => {
      const r = await window.desktop.gitShow({ projectId, sha: sha! })
      if (!r.ok) throw new Error(r.error)
      return r.data
    },
    enabled: !!sha
  })

  const data = commits.data ?? []

  return (
    <>
      <Table<GitLocalCommit>
        rowKey="id"
        size="small"
        loading={commits.isLoading}
        dataSource={data}
        locale={{ emptyText: commits.isError ? (commits.error as Error).message : '暂无提交' }}
        onRow={(c) => ({ onClick: () => setSha(c.id), style: { cursor: 'pointer' } })}
        pagination={{
          current: page,
          pageSize,
          // git log 不方便拿总数：有下一页时多显示一页占位
          total: data.length < pageSize ? (page - 1) * pageSize + data.length : page * pageSize + 1,
          showSizeChanger: true,
          onChange: (p, s) => {
            setPage(p)
            setPageSize(s)
          }
        }}
        columns={[
          { title: '提交信息', dataIndex: 'subject', ellipsis: true },
          { title: '作者', dataIndex: 'authorName', width: 140 },
          { title: '时间', dataIndex: 'date', width: 120, render: (v: string) => <TimeAgo value={v} /> },
          {
            title: 'SHA',
            dataIndex: 'shortId',
            width: 100,
            render: (v: string) => <Typography.Text code>{v}</Typography.Text>
          }
        ]}
      />
      <Drawer
        open={!!sha}
        onClose={() => setSha(undefined)}
        width={720}
        destroyOnClose
        title={detail.data ? detail.data.commit.subject : '提交详情'}
      >
        {detail.isLoading ? (
          <Spin />
        ) : detail.isError ? (
          <Empty description={(detail.error as Error).message} />
        ) : detail.data ? (
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <div>
              <Typography.Text type="secondary">
                {detail.data.commit.authorName} · <TimeAgo value={detail.data.commit.date} /> ·{' '}
                <Typography.Text code copyable={{ text: detail.data.commit.id }}>
                  {detail.data.commit.shortId}
                </Typography.Text>
              </Typography.Text>
            </div>
            {(detail.data.commit.body || detail.data.commit.subject) && (
              <pre className="pre-text">
                {detail.data.commit.subject}
                {detail.data.commit.body ? `\n\n${detail.data.commit.body}` : ''}
              </pre>
            )}
            <LocalDiffView text={detail.data.diff} />
          </Space>
        ) : null}
      </Drawer>
    </>
  )
}

function RepoPanel({ projectId, path }: { projectId: number; path: string }) {
  const { message, modal } = AntApp.useApp()
  const qc = useQueryClient()
  const env = useGitEnv()
  const navigate = useNavigate()
  const [messageText, setMessageText] = useState('')
  const [selected, setSelected] = useState<{ path: string; staged: 'worktree' | 'staged' } | null>(null)
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState('changes')

  const project = useQuery({
    queryKey: ['project', projectId],
    queryFn: ({ signal }) => get<Project>(`/projects/${projectId}`, undefined, signal)
  })
  const status = useQuery({
    queryKey: ['git-status', projectId],
    queryFn: async () => {
      const r = await window.desktop.gitStatus(projectId)
      if (!r.ok) throw new Error(r.error)
      return r.data
    },
    refetchInterval: 5000
  })
  const branches = useQuery({
    queryKey: ['git-branches', projectId],
    queryFn: async () => {
      const r = await window.desktop.gitBranches(projectId)
      if (!r.ok) throw new Error(r.error)
      return r.data
    }
  })
  const diff = useQuery({
    queryKey: ['git-diff', projectId, selected?.path, selected?.staged],
    queryFn: async () => {
      if (!selected) return ''
      const r = await window.desktop.gitDiff({ projectId, path: selected.path, staged: selected.staged })
      if (!r.ok) throw new Error(r.error)
      return r.data
    },
    enabled: !!selected
  })

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['git-status', projectId] }),
      qc.invalidateQueries({ queryKey: ['git-branches', projectId] }),
      qc.invalidateQueries({ queryKey: ['git-diff', projectId] }),
      qc.invalidateQueries({ queryKey: ['git-log', projectId] })
    ])
  }

  const runGit = async (fn: () => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>, okMsg?: string) => {
    setBusy(true)
    try {
      const r = await fn()
      if (!r.ok) {
        modal.error({ title: '操作失败', content: r.error })
        return false
      }
      if (okMsg) message.success(typeof r.data === 'string' ? r.data : okMsg)
      await refresh()
      return true
    } finally {
      setBusy(false)
    }
  }

  const open = async (t: OpenTarget) => {
    const r = await window.desktop.gitOpen(projectId, t)
    if (!r.ok) message.error(r.error)
  }

  const st = status.data
  const rows = useMemo(() => {
    if (!st) return []
    return [
      ...st.staged.map((f) => ({ ...f, area: 'staged' as const, key: `s:${f.path}` })),
      ...st.unstaged.map((f) => ({ ...f, area: 'unstaged' as const, key: `u:${f.path}` })),
      ...st.untracked.map((f) => ({ ...f, area: 'untracked' as const, key: `t:${f.path}` }))
    ]
  }, [st])

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div>
        <Typography.Title level={5} style={{ marginTop: 0, marginBottom: 4 }}>
          {project.data?.name_with_namespace || `项目 #${projectId}`}
        </Typography.Title>
        <Typography.Text type="secondary" copyable>
          {path}
        </Typography.Text>
      </div>

      <Space wrap>
        <span>
          分支{' '}
          <Select
            style={{ minWidth: 180 }}
            loading={branches.isLoading}
            value={st?.branch}
            options={(branches.data ?? []).map((b) => ({ value: b.name, label: b.current ? `${b.name}（当前）` : b.name }))}
            onChange={(v) => void runGit(() => window.desktop.gitCheckout(projectId, v))}
          />
        </span>
        {st?.upstream && (
          <Typography.Text type="secondary">
            跟踪 {st.upstream}
            {st.ahead > 0 ? ` · 超前 ${st.ahead}` : ''}
            {st.behind > 0 ? ` · 落后 ${st.behind}` : ''}
          </Typography.Text>
        )}
        <Button loading={busy} onClick={() => void runGit(() => window.desktop.gitPull(projectId))}>
          拉取更新
        </Button>
        <Button type="primary" loading={busy} onClick={() => void runGit(() => window.desktop.gitPush(projectId))}>
          推送
        </Button>
        <Button onClick={() => void open('folder')}>打开文件夹</Button>
        {env.data?.editors.vscode && <Button onClick={() => void open('vscode')}>VS Code</Button>}
        {env.data?.editors.cursor && <Button onClick={() => void open('cursor')}>Cursor</Button>}
        <Button onClick={() => navigate(`/projects/${projectId}`)}>项目详情</Button>
        <Button
          danger
          type="link"
          onClick={() => {
            modal.confirm({
              title: '移除本地克隆记录？',
              content: '只删除软件里的记录，不会删除磁盘上的文件夹',
              onOk: async () => {
                await window.desktop.gitForget(projectId)
                await qc.invalidateQueries({ queryKey: ['git-clones'] })
                message.success('已移除记录')
              }
            })
          }}
        >
          忘记路径
        </Button>
      </Space>

      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: 'changes',
            label: '工作区',
            children: status.isLoading ? (
              <Spin />
            ) : status.isError ? (
              <Empty description={(status.error as Error).message} />
            ) : (
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <Table
                  size="small"
                  rowKey="key"
                  pagination={false}
                  dataSource={rows}
                  locale={{ emptyText: '工作区干净，没有变更' }}
                  onRow={(r) => ({
                    onClick: () =>
                      setSelected({
                        path: r.path,
                        staged: r.area === 'staged' ? 'staged' : 'worktree'
                      })
                  })}
                  columns={[
                    {
                      title: '区域',
                      width: 90,
                      render: (_, r) =>
                        r.area === 'staged' ? (
                          <Tag color="blue">已暂存</Tag>
                        ) : r.area === 'untracked' ? (
                          <Tag>未跟踪</Tag>
                        ) : (
                          <Tag color="orange">未暂存</Tag>
                        )
                    },
                    { title: '状态', width: 80, render: (_, r) => statusLabel(r, r.area) },
                    {
                      title: '文件',
                      render: (_, r) => (r.from ? `${r.from} → ${r.path}` : r.path)
                    },
                    {
                      title: '操作',
                      width: 160,
                      render: (_, r) =>
                        r.area === 'staged' ? (
                          <Button
                            size="small"
                            type="link"
                            disabled={busy}
                            onClick={(e) => {
                              e.stopPropagation()
                              void runGit(() => window.desktop.gitUnstage(projectId, [r.path]), '已取消暂存')
                            }}
                          >
                            取消暂存
                          </Button>
                        ) : (
                          <Button
                            size="small"
                            type="link"
                            disabled={busy}
                            onClick={(e) => {
                              e.stopPropagation()
                              void runGit(() => window.desktop.gitStage(projectId, [r.path]), '已暂存')
                            }}
                          >
                            暂存
                          </Button>
                        )
                    }
                  ]}
                />

                <Space direction="vertical" style={{ width: '100%' }}>
                  <Input.TextArea
                    rows={2}
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    placeholder="提交说明"
                  />
                  <Button
                    type="primary"
                    disabled={!messageText.trim() || !st?.staged.length}
                    loading={busy}
                    onClick={async () => {
                      const ok = await runGit(() => window.desktop.gitCommit(projectId, messageText))
                      if (ok) setMessageText('')
                    }}
                  >
                    提交
                  </Button>
                  {st && st.staged.length === 0 && (
                    <Typography.Text type="secondary">暂存区为空时无法提交，请先点文件旁的「暂存」。</Typography.Text>
                  )}
                </Space>

                {selected && (
                  <Card
                    size="small"
                    title={`差异：${selected.path}（${selected.staged === 'staged' ? '已暂存' : '工作区'}）`}
                    extra={
                      <Button type="link" size="small" onClick={() => setSelected(null)}>
                        关闭
                      </Button>
                    }
                  >
                    {diff.isLoading ? <Spin /> : <LocalDiffView text={diff.data ?? ''} />}
                  </Card>
                )}
              </Space>
            )
          },
          {
            key: 'commits',
            label: '提交记录',
            children: <LocalCommitsPanel projectId={projectId} branch={st?.branch} />
          }
        ]}
      />
    </Space>
  )
}

function UnmatchedPanel({ item }: { item: Extract<ListItem, { kind: 'unmatched' }> }) {
  const { message } = AntApp.useApp()
  const env = useGitEnv()
  const open = async (t: OpenTarget) => {
    const r = await window.desktop.gitOpenPath(item.path, t)
    if (!r.ok) message.error(r.error)
  }
  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div>
        <Typography.Title level={5} style={{ marginTop: 0, marginBottom: 4 }}>
          {item.title}
        </Typography.Title>
        <Typography.Text type="secondary" copyable>
          {item.path}
        </Typography.Text>
      </div>
      <Alert
        type="warning"
        showIcon
        message="未匹配到当前服务器上的项目"
        description="本地 origin 地址与当前登录的 GitLab / 极狐账号下的仓库对不上。可打开文件夹查看，或确认 remote 是否指向本服务器后再重新扫描。"
      />
      <Typography.Paragraph>
        <div>
          <Typography.Text type="secondary">当前分支：</Typography.Text> {item.branch || '未知'}
        </div>
        <div>
          <Typography.Text type="secondary">origin：</Typography.Text>{' '}
          {item.remote ? <Typography.Text copyable>{item.remote}</Typography.Text> : '无'}
        </div>
      </Typography.Paragraph>
      <Space wrap>
        <Button onClick={() => void open('folder')}>打开文件夹</Button>
        {env.data?.editors.vscode && <Button onClick={() => void open('vscode')}>VS Code</Button>}
        {env.data?.editors.cursor && <Button onClick={() => void open('cursor')}>Cursor</Button>}
        <Button onClick={() => void open('terminal')}>在终端打开</Button>
      </Space>
    </Space>
  )
}

export default function WorkspacePage() {
  const { message, modal } = AntApp.useApp()
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const projectParam = params.get('project')
  const selectedKey =
    params.get('sel') || (projectParam ? `p-${projectParam}` : undefined)
  const [scanning, setScanning] = useState(false)
  const [lastScan, setLastScan] = useState<ScanResult | null>(null)

  const clones = useQuery({ queryKey: ['git-clones'], queryFn: () => window.desktop.gitClones() })
  const scanDir = useQuery({ queryKey: ['git-scan-dir'], queryFn: () => window.desktop.gitScanDir() })

  const ids = useMemo(
    () =>
      Object.entries(clones.data ?? {})
        .map(([id, path]) => ({ id: Number(id), path }))
        .sort((a, b) => a.id - b.id),
    [clones.data]
  )

  const names = useQuery({
    queryKey: ['git-clone-names', ids.map((i) => i.id).join(',')],
    queryFn: async ({ signal }) => {
      const map: Record<number, string> = {}
      await Promise.all(
        ids.map(async ({ id }) => {
          try {
            const p = await get<Project>(`/projects/${id}`, undefined, signal)
            map[id] = p.name_with_namespace
          } catch {
            map[id] = `项目 #${id}`
          }
        })
      )
      return map
    },
    enabled: ids.length > 0
  })

  const unmatched = useMemo(() => {
    const linkedPaths = new Set(ids.map((i) => i.path.toLowerCase()))
    return (lastScan?.repos ?? []).filter((r: ScannedRepo) => !r.projectId && !linkedPaths.has(r.dir.toLowerCase()))
  }, [lastScan, ids])

  const items: ListItem[] = useMemo(() => {
    const linked: ListItem[] = ids.map((i) => ({
      key: `p-${i.id}`,
      kind: 'linked',
      projectId: i.id,
      path: i.path,
      title: names.data?.[i.id] || `项目 #${i.id}`
    }))
    const extra: ListItem[] = unmatched.map((r) => ({
      key: `u-${r.dir}`,
      kind: 'unmatched',
      path: r.dir,
      title: r.name,
      remote: r.remote,
      branch: r.branch
    }))
    return [...linked, ...extra]
  }, [ids, names.data, unmatched])

  useEffect(() => {
    if (selectedKey && items.some((i) => i.key === selectedKey)) return
    if (items.length > 0) setParams({ sel: items[0].key }, { replace: true })
  }, [items, selectedKey, setParams])

  const current = items.find((i) => i.key === selectedKey)

  const doScan = async (root?: string) => {
    let dir = root
    if (!dir) {
      dir = (await window.desktop.chooseDir(scanDir.data || undefined)) ?? undefined
      if (!dir) return
    }
    setScanning(true)
    try {
      const r = await window.desktop.gitScan(dir)
      if (!r.ok) {
        modal.error({ title: '扫描失败', content: r.error })
        return
      }
      setLastScan(r.data)
      await qc.invalidateQueries({ queryKey: ['git-clones'] })
      await qc.invalidateQueries({ queryKey: ['git-scan-dir'] })
      const parts = [
        `找到 ${r.data.repos.length} 个仓库`,
        `匹配云端 ${r.data.matched} 个`,
        r.data.linked ? `新关联 ${r.data.linked} 个` : null,
        r.data.unmatched ? `未匹配 ${r.data.unmatched} 个` : null
      ].filter(Boolean)
      message.success(parts.join(' · '))
      if (r.data.truncated) {
        message.warning('目录较深或仓库较多，已截断扫描结果。可缩小扫描范围后再试。')
      }
    } finally {
      setScanning(false)
    }
  }

  return (
    <Card
      title="本地仓库"
      extra={
        <Space wrap>
          {scanDir.data && (
            <Typography.Text type="secondary" style={{ maxWidth: 280 }} ellipsis={{ tooltip: scanDir.data }}>
              上次：{scanDir.data}
            </Typography.Text>
          )}
          {scanDir.data && (
            <Button icon={<ReloadOutlined />} loading={scanning} onClick={() => void doScan(scanDir.data!)}>
              重新扫描
            </Button>
          )}
          <Button type="primary" icon={<FolderOpenOutlined />} loading={scanning} onClick={() => void doScan()}>
            扫描本地文件夹
          </Button>
        </Space>
      }
      styles={{ body: { padding: 0 } }}
    >
      {clones.isLoading ? (
        <Spin style={{ margin: 40 }} />
      ) : items.length === 0 ? (
        <Empty
          style={{ margin: 40 }}
          description="还没有本地仓库。可扫描本机文件夹自动发现 Git 项目并匹配云端，或到项目详情页「拉取代码」。"
        >
          <Button type="primary" loading={scanning} onClick={() => void doScan()}>
            扫描本地文件夹
          </Button>
        </Empty>
      ) : (
        <Layout style={{ background: 'transparent', minHeight: 480 }}>
          <Sider width={280} theme="light" style={{ borderRight: '1px solid #f0f0f0', background: '#fff' }}>
            {lastScan && (
              <div style={{ padding: '8px 12px', borderBottom: '1px solid #f0f0f0', fontSize: 12, color: '#8c8c8c' }}>
                最近扫描：匹配 {lastScan.matched} · 未匹配 {lastScan.unmatched}
              </div>
            )}
            <List
              size="small"
              dataSource={items}
              renderItem={(item) => (
                <List.Item
                  style={{
                    cursor: 'pointer',
                    padding: '10px 16px',
                    background: item.key === selectedKey ? '#e6f4ff' : undefined
                  }}
                  onClick={() => setParams({ sel: item.key })}
                >
                  <List.Item.Meta
                    title={
                      <Space size={6}>
                        <span>{item.title}</span>
                        {item.kind === 'linked' ? <Tag color="success">已匹配</Tag> : <Tag>未匹配</Tag>}
                      </Space>
                    }
                    description={
                      <Typography.Text type="secondary" ellipsis style={{ maxWidth: 240, fontSize: 12 }}>
                        {item.path}
                      </Typography.Text>
                    }
                  />
                </List.Item>
              )}
            />
          </Sider>
          <Content style={{ padding: 16, background: '#fff' }}>
            {!current ? (
              <Empty description="请选择仓库" />
            ) : current.kind === 'linked' ? (
              <RepoPanel projectId={current.projectId} path={current.path} />
            ) : (
              <UnmatchedPanel item={current} />
            )}
          </Content>
        </Layout>
      )}
    </Card>
  )
}
