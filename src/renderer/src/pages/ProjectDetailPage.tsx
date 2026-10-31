import { useEffect, useMemo, useState } from 'react'
import {
  App as AntApp,
  Breadcrumb,
  Button,
  Card,
  Checkbox,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Popover,
  Progress,
  Result,
  Segmented,
  Select,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
  Typography
} from 'antd'
import { ArrowLeftOutlined, CopyOutlined, FileOutlined, FolderFilled, LinkOutlined } from '@ant-design/icons'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { del, get, getAll, getPage, openExternal, post, useAction } from '../api'
import { TimeAgo, visibilityText } from '../labels'
import CodeView from '../components/CodeView'
import DiffList from '../components/DiffList'
import Markdown from '../components/Markdown'
import ProjectSettings from '../components/ProjectSettings'
import RollbackModal, { RevertCommitModal } from '../components/RollbackModal'
import CloneButton from '../components/CloneModal'
import type { Branch, Commit, Diff, Project, RepoFile, RepoTag, TreeItem } from '../types'

type Update = (patch: Record<string, string | undefined>) => void

const IMAGE_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml'
}
const MAX_PREVIEW = 2 * 1024 * 1024

function extOf(name: string): string {
  return name.toLowerCase().split('.').pop() ?? ''
}

function isMarkdown(name: string): boolean {
  return ['md', 'markdown'].includes(extOf(name))
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** 解码 base64 文件内容；先按 UTF-8，失败再按 GBK（老项目里常见） */
function decodeContent(b64: string): { binary: boolean; text: string } {
  const bin = atob(b64.replace(/\s/g, ''))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  if (bytes.subarray(0, 8000).includes(0)) return { binary: true, text: '' }
  try {
    return { binary: false, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  } catch {
    return { binary: false, text: new TextDecoder('gbk').decode(bytes) }
  }
}

function pageTotal(page: number, pageSize: number, count: number, total: number | null): number {
  if (total != null) return total
  return count === pageSize ? page * pageSize + 1 : (page - 1) * pageSize + count
}

function RefSelect({ projectId, value, onChange }: { projectId: number; value: string; onChange: (v: string) => void }) {
  const [input, setInput] = useState('')
  const [search, setSearch] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setSearch(input), 300)
    return () => clearTimeout(t)
  }, [input])
  const branches = useQuery({
    queryKey: ['branches', projectId, search],
    queryFn: ({ signal }) => get<Branch[]>(`/projects/${projectId}/repository/branches`, { search, per_page: 50 }, signal)
  })
  const tags = useQuery({
    queryKey: ['tags', projectId, search],
    queryFn: ({ signal }) => get<RepoTag[]>(`/projects/${projectId}/repository/tags`, { search, per_page: 30 }, signal)
  })
  const options = [
    { label: '分支', options: (branches.data ?? []).map((b) => ({ value: b.name, label: b.name })) },
    { label: '标签', options: (tags.data ?? []).map((t) => ({ value: t.name, label: t.name })) }
  ]
  const known = options.some((g) => g.options.some((o) => o.value === value))
  if (value && !known) {
    options.unshift({ label: '当前', options: [{ value, label: /^[0-9a-f]{40}$/.test(value) ? value.slice(0, 8) : value }] })
  }
  return (
    <Select
      showSearch
      value={value}
      style={{ width: 220 }}
      filterOption={false}
      onSearch={setInput}
      onChange={onChange}
      loading={branches.isFetching || tags.isFetching}
      options={options}
    />
  )
}

function FileContent({
  projectId,
  refName,
  path,
  webUrl,
  update,
  compact
}: {
  projectId: number
  refName: string
  path: string
  webUrl: string
  update: Update
  compact?: boolean
}) {
  const [mode, setMode] = useState<'preview' | 'source'>('preview')
  const file = useQuery({
    queryKey: ['file', projectId, refName, path],
    queryFn: ({ signal }) =>
      get<RepoFile>(`/projects/${projectId}/repository/files/${encodeURIComponent(path)}`, { ref: refName }, signal)
  })
  const name = path.split('/').pop() ?? path
  const ext = extOf(name)
  const decoded = useMemo(() => {
    const f = file.data
    if (!f || IMAGE_EXT[ext] || f.size > MAX_PREVIEW) return null
    return decodeContent(f.content)
  }, [file.data, ext])

  if (file.isLoading) return <Spin />
  if (file.error) return <Empty description={(file.error as Error).message} />
  const f = file.data!
  const md = isMarkdown(name)

  let body
  if (IMAGE_EXT[ext]) {
    body = (
      <div style={{ textAlign: 'center', padding: 16 }}>
        <img src={`data:${IMAGE_EXT[ext]};base64,${f.content}`} style={{ maxWidth: '100%' }} />
      </div>
    )
  } else if (f.size > MAX_PREVIEW) {
    body = <Empty description={`文件较大（${formatSize(f.size)}），请在浏览器中查看`} />
  } else if (decoded?.binary) {
    body = <Empty description="二进制文件，无法预览" />
  } else if (md && mode === 'preview') {
    body = <Markdown source={decoded?.text ?? ''} />
  } else {
    body = <CodeView code={decoded?.text ?? ''} fileName={name} />
  }

  return (
    <Card
      size="small"
      title={
        <Space>
          <FileOutlined />
          {name}
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {formatSize(f.size)}
          </Typography.Text>
        </Space>
      }
      extra={
        <Space>
          {md && (
            <Segmented
              size="small"
              value={mode}
              onChange={(v) => setMode(v as 'preview' | 'source')}
              options={[
                { label: '预览', value: 'preview' },
                { label: '源码', value: 'source' }
              ]}
            />
          )}
          {decoded && !decoded.binary && (
            <Typography.Text copyable={{ text: decoded.text, tooltips: ['复制全部内容', '已复制'] }} />
          )}
          {!compact && <a onClick={() => update({ tab: 'commits', path })}>历史</a>}
          {compact && <a onClick={() => update({ path, type: 'blob' })}>查看文件</a>}
          <a onClick={() => openExternal(`${webUrl}/-/blob/${encodeURIComponent(refName)}/${path}`)}>网页</a>
        </Space>
      }
      styles={{ body: { padding: md && mode === 'preview' ? 16 : 0 } }}
    >
      {body}
    </Card>
  )
}

function TreeView({ project, refName, path, update }: { project: Project; refName: string; path: string; update: Update }) {
  const tree = useQuery({
    queryKey: ['tree', project.id, refName, path],
    queryFn: ({ signal }) =>
      getAll<TreeItem>(`/projects/${project.id}/repository/tree`, { ref: refName, path: path || undefined }, 20, signal)
  })
  const last = useQuery({
    queryKey: ['last-commit', project.id, refName, path],
    queryFn: ({ signal }) =>
      get<Commit[]>(
        `/projects/${project.id}/repository/commits`,
        { ref_name: refName, path: path || undefined, per_page: 1 },
        signal
      )
  })

  const rows = useMemo(() => {
    const items = [...(tree.data ?? [])].sort((a, b) =>
      a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'tree' ? -1 : 1
    )
    if (path) items.unshift({ id: '..', name: '..', type: 'tree', path: path.split('/').slice(0, -1).join('/') })
    return items
  }, [tree.data, path])

  const readme = (tree.data ?? []).find((i) => i.type === 'blob' && /^readme(\.(md|markdown|txt|rst))?$/i.test(i.name))
  const open = (i: TreeItem) => {
    if (i.type === 'commit') return
    update({ path: i.path || undefined, type: i.type === 'blob' ? 'blob' : undefined })
  }
  const c = last.data?.[0]

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {c && (
        <Card size="small">
          <Space wrap>
            <Typography.Text strong>{c.author_name}</Typography.Text>
            <a onClick={() => update({ tab: 'commits', path: path || undefined })}>{c.title}</a>
            <Typography.Text code>{c.short_id}</Typography.Text>
            <Typography.Text type="secondary">
              <TimeAgo value={c.committed_date} />
            </Typography.Text>
          </Space>
        </Card>
      )}
      <Table<TreeItem>
        rowKey={(i) => i.id + i.path}
        size="small"
        bordered
        showHeader={false}
        loading={tree.isLoading}
        dataSource={rows}
        pagination={false}
        locale={{ emptyText: tree.error ? (tree.error as Error).message : '空目录' }}
        onRow={(i) => ({ onClick: () => open(i), className: i.type === 'commit' ? undefined : 'clickable' })}
        columns={[
          {
            render: (_, i) => (
              <Space>
                {i.type === 'tree' ? (
                  <FolderFilled style={{ color: '#1677ff' }} />
                ) : i.type === 'commit' ? (
                  <LinkOutlined />
                ) : (
                  <FileOutlined />
                )}
                <span>{i.name}</span>
                {i.type === 'commit' && <Tag>子模块</Tag>}
              </Space>
            )
          }
        ]}
      />
      {readme && (
        <FileContent
          projectId={project.id}
          refName={refName}
          path={readme.path}
          webUrl={project.web_url}
          update={update}
          compact
        />
      )}
    </Space>
  )
}

function CodeTab({ project, refName, path, type, update }: { project: Project; refName: string; path: string; type: string; update: Update }) {
  const segments = path ? path.split('/') : []
  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Space wrap>
        <RefSelect projectId={project.id} value={refName} onChange={(r) => update({ ref: r, path: undefined, type: undefined })} />
        <Breadcrumb
          items={[
            { title: <a onClick={() => update({ path: undefined, type: undefined })}>{project.name}</a> },
            ...segments.map((s, i) => ({
              title:
                i === segments.length - 1 ? (
                  s
                ) : (
                  <a onClick={() => update({ path: segments.slice(0, i + 1).join('/'), type: undefined })}>{s}</a>
                )
            }))
          ]}
        />
      </Space>
      {type === 'blob' ? (
        <FileContent projectId={project.id} refName={refName} path={path} webUrl={project.web_url} update={update} />
      ) : (
        <TreeView project={project} refName={refName} path={path} update={update} />
      )}
    </Space>
  )
}

function CommitDrawer({
  projectId,
  sha,
  onClose,
  update,
  onRollback,
  onRevert
}: {
  projectId: number
  sha?: string
  onClose: () => void
  update: Update
  onRollback: (c: Commit) => void
  onRevert: (c: Commit) => void
}) {
  const commit = useQuery({
    queryKey: ['commit', projectId, sha],
    queryFn: ({ signal }) => get<Commit>(`/projects/${projectId}/repository/commits/${sha}`, undefined, signal),
    enabled: !!sha
  })
  const diff = useQuery({
    queryKey: ['commit-diff', projectId, sha],
    queryFn: ({ signal }) => getAll<Diff>(`/projects/${projectId}/repository/commits/${sha}/diff`, {}, undefined, signal),
    enabled: !!sha
  })
  const c = commit.data
  return (
    <Drawer
      open={!!sha}
      onClose={onClose}
      width={900}
      title={c ? c.title : '提交详情'}
      extra={
        c && (
          <Space>
            <Button
              onClick={() => {
                onClose()
                update({ tab: 'code', ref: c.id, path: undefined, type: undefined })
              }}
            >
              浏览此版本代码
            </Button>
            <Button onClick={() => onRollback(c)}>回滚到此提交</Button>
            <Button onClick={() => onRevert(c)}>撤销此提交</Button>
            {c.web_url && <Button onClick={() => openExternal(c.web_url!)}>网页</Button>}
          </Space>
        )
      }
    >
      {!c ? (
        <Spin />
      ) : (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Space wrap>
            <Typography.Text strong>{c.author_name}</Typography.Text>
            <Typography.Text type="secondary">{c.author_email}</Typography.Text>
            <TimeAgo value={c.committed_date} />
            <Typography.Text code copyable>
              {c.id}
            </Typography.Text>
            {c.stats && (
              <span>
                <span style={{ color: '#52c41a' }}>+{c.stats.additions}</span>{' '}
                <span style={{ color: '#ff4d4f' }}>-{c.stats.deletions}</span>
              </span>
            )}
          </Space>
          {c.message.trim() !== c.title && <pre className="pre-text">{c.message}</pre>}
          {diff.isLoading ? <Spin /> : <DiffList diffs={diff.data ?? []} />}
        </Space>
      )}
    </Drawer>
  )
}

function CommitsTab({ projectId, refName, path, update }: { projectId: number; refName: string; path: string; update: Update }) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(30)
  const [sha, setSha] = useState<string>()
  const [rollback, setRollback] = useState<string>()
  const [revert, setRevert] = useState<Commit>()
  useEffect(() => setPage(1), [refName, path])

  const commits = useQuery({
    queryKey: ['commits', projectId, refName, path, page, pageSize],
    queryFn: ({ signal }) =>
      getPage<Commit>(
        `/projects/${projectId}/repository/commits`,
        {
          ref_name: refName,
          path: path || undefined,
          page,
          per_page: pageSize
        },
        signal
      )
  })
  const data = commits.data?.data ?? []

  return (
    <>
      <Space wrap style={{ marginBottom: 16 }}>
        <RefSelect projectId={projectId} value={refName} onChange={(r) => update({ ref: r })} />
        {path && (
          <Tag closable onClose={() => update({ path: undefined, type: undefined })}>
            仅看：{path}
          </Tag>
        )}
      </Space>
      <Table<Commit>
        rowKey="id"
        size="small"
        loading={commits.isLoading}
        dataSource={data}
        onRow={(c) => ({ onClick: () => setSha(c.id), className: 'clickable' })}
        pagination={{
          current: page,
          pageSize,
          total: pageTotal(page, pageSize, data.length, commits.data?.total ?? null),
          showTotal: commits.data?.total != null ? (n) => `共 ${n} 个提交` : undefined,
          onChange: (p, s) => {
            setPage(p)
            setPageSize(s)
          }
        }}
        columns={[
          { title: '提交信息', dataIndex: 'title', ellipsis: true },
          { title: '作者', dataIndex: 'author_name', width: 140 },
          { title: '时间', dataIndex: 'committed_date', width: 120, render: (v) => <TimeAgo value={v} /> },
          { title: 'SHA', dataIndex: 'short_id', width: 100, render: (v) => <Typography.Text code>{v}</Typography.Text> },
          {
            title: '操作',
            width: 180,
            render: (_, c) => (
              <Space onClick={(e) => e.stopPropagation()}>
                <a onClick={() => setRollback(c.id)}>回滚到此提交</a>
                <a onClick={() => setRevert(c)}>撤销</a>
              </Space>
            )
          }
        ]}
      />
      <CommitDrawer
        projectId={projectId}
        sha={sha}
        onClose={() => setSha(undefined)}
        update={update}
        onRollback={(c) => setRollback(c.id)}
        onRevert={setRevert}
      />
      {rollback && (
        <RollbackModal projectId={projectId} branch={refName} target={rollback} onClose={() => setRollback(undefined)} />
      )}
      {revert && <RevertCommitModal projectId={projectId} commit={revert} branch={refName} onClose={() => setRevert(undefined)} />}
    </>
  )
}

type BranchSort = 'updated_desc' | 'updated_asc' | 'name_asc'

const branchTime = (b: Branch) => (b.commit?.committed_date ? Date.parse(b.commit.committed_date) : 0)
const deletable = (b: Branch) => !b.default && !b.protected

function BranchesTab({ project, refName, update }: { project: Project; refName: string; update: Update }) {
  const run = useAction()
  const { message, modal } = AntApp.useApp()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<BranchSort>('updated_desc')
  const [onlyMerged, setOnlyMerged] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [selected, setSelected] = useState<string[]>([])
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [creating, setCreating] = useState(false)
  const [rollback, setRollback] = useState<string>()
  const [form] = Form.useForm<{ branch: string; ref: string }>()
  const key = ['branch-list', project.id]
  const branches = useQuery({
    queryKey: [...key, search],
    queryFn: ({ signal }) => getAll<Branch>(`/projects/${project.id}/repository/branches`, { search }, 20, signal)
  })

  const data = useMemo(() => {
    const list = (branches.data ?? []).filter((b) => !onlyMerged || b.merged)
    if (sort === 'name_asc') return list.sort((a, b) => a.name.localeCompare(b.name))
    return list.sort((a, b) => (sort === 'updated_desc' ? branchTime(b) - branchTime(a) : branchTime(a) - branchTime(b)))
  }, [branches.data, sort, onlyMerged])

  const refreshBranches = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: key }),
      qc.invalidateQueries({ queryKey: ['branches', project.id] })
    ])
  }

  const deleteSelected = async () => {
    const names = [...selected]
    const failed: { name: string; error: string }[] = []
    setProgress({ done: 0, total: names.length })
    for (const [i, name] of names.entries()) {
      try {
        await del(`/projects/${project.id}/repository/branches/${encodeURIComponent(name)}`)
      } catch (e) {
        failed.push({ name, error: (e as Error).message })
      }
      setProgress({ done: i + 1, total: names.length })
    }
    setProgress(null)
    setSelected(failed.map((f) => f.name))
    await refreshBranches()
    const ok = names.length - failed.length
    if (failed.length === 0) {
      message.success(`已删除 ${ok} 个分支`)
    } else {
      modal.warning({
        title: `删除完成：成功 ${ok} 个，失败 ${failed.length} 个`,
        width: 560,
        content: (
          <ul style={{ paddingLeft: 20, maxHeight: 300, overflow: 'auto' }}>
            {failed.map((f) => (
              <li key={f.name}>
                <b>{f.name}</b>：{f.error}
              </li>
            ))}
          </ul>
        )
      })
    }
  }

  const confirmBatchDelete = () => {
    modal.confirm({
      title: `确定删除选中的 ${selected.length} 个分支？`,
      width: 520,
      okText: '删除',
      okButtonProps: { danger: true },
      content: (
        <>
          <div style={{ marginBottom: 8 }}>删除后无法恢复：</div>
          <ul style={{ paddingLeft: 20, maxHeight: 260, overflow: 'auto' }}>
            {selected.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </>
      ),
      onOk: () => void deleteSelected()
    })
  }

  const selectMerged = () => {
    const names = (branches.data ?? []).filter((b) => b.merged && deletable(b)).map((b) => b.name)
    setSelected(names)
    if (names.length === 0) message.info('没有可删除的已合并分支')
  }

  const cleanMerged = () => {
    modal.confirm({
      title: '清理所有已合并分支？',
      width: 520,
      okText: '确认清理',
      okButtonProps: { danger: true },
      content: `将删除所有已合并到默认分支（${project.default_branch}）的分支，受保护分支不受影响。GitLab 会在后台执行，可能需要几秒到几分钟，且无法恢复。`,
      onOk: () =>
        run(() => del(`/projects/${project.id}/repository/merged_branches`), '已提交清理任务，稍后刷新查看结果', [
          key,
          ['branches', project.id]
        ])
    })
  }

  const create = async (v: { branch: string; ref: string }) => {
    const ok = await run(
      () => post(`/projects/${project.id}/repository/branches`, { branch: v.branch, ref: v.ref }),
      '分支已创建',
      [key, ['branches', project.id]]
    )
    if (ok) {
      setCreating(false)
      form.resetFields()
    }
  }

  return (
    <>
      <Space wrap style={{ marginBottom: 16 }}>
        <Input.Search
          allowClear
          placeholder="搜索分支"
          style={{ width: 220 }}
          onSearch={(v) => {
            setSearch(v)
            setPage(1)
            setSelected([])
          }}
        />
        <Select<BranchSort>
          value={sort}
          style={{ width: 130 }}
          onChange={setSort}
          options={[
            { value: 'updated_desc', label: '最近更新在前' },
            { value: 'updated_asc', label: '最早更新在前' },
            { value: 'name_asc', label: '按名称' }
          ]}
        />
        <Checkbox
          checked={onlyMerged}
          onChange={(e) => {
            setOnlyMerged(e.target.checked)
            setPage(1)
          }}
        >
          只看已合并
        </Checkbox>
        <Button
          type="primary"
          onClick={() => {
            form.setFieldsValue({ ref: refName })
            setCreating(true)
          }}
        >
          新建分支
        </Button>
        <Button onClick={selectMerged}>选中已合并分支</Button>
        <Button danger disabled={selected.length === 0 || progress !== null} onClick={confirmBatchDelete}>
          批量删除{selected.length ? `（${selected.length}）` : ''}
        </Button>
        {selected.length > 0 && progress === null && <a onClick={() => setSelected([])}>取消选择</a>}
        <Button danger type="dashed" onClick={cleanMerged}>
          清理已合并分支
        </Button>
      </Space>
      {progress && (
        <Progress
          percent={Math.round((progress.done / progress.total) * 100)}
          format={() => `正在删除 ${progress.done}/${progress.total}`}
          style={{ marginBottom: 12 }}
        />
      )}
      <Table<Branch>
        rowKey="name"
        size="small"
        loading={branches.isLoading || branches.isFetching}
        dataSource={data}
        rowSelection={{
          selectedRowKeys: selected,
          preserveSelectedRowKeys: true,
          onChange: (keys) => setSelected(keys as string[]),
          getCheckboxProps: (b) => ({
            disabled: !deletable(b) || progress !== null,
            title: b.default ? '默认分支不能删除' : b.protected ? '受保护分支不能删除' : undefined
          })
        }}
        onChange={(_, __, sorter) => {
          const s = Array.isArray(sorter) ? sorter[0] : sorter
          if (s?.columnKey === 'updated') {
            setSort(s.order === 'ascend' ? 'updated_asc' : 'updated_desc')
          }
        }}
        pagination={{
          current: page,
          pageSize,
          total: data.length,
          showSizeChanger: true,
          showTotal: (n) => `共 ${n} 个分支`,
          onChange: (p, s) => {
            setPage(p)
            setPageSize(s)
          }
        }}
        columns={[
          {
            title: '分支',
            render: (_, b) => (
              <Space>
                <a onClick={() => update({ tab: 'code', ref: b.name, path: undefined, type: undefined })}>{b.name}</a>
                {b.default && <Tag color="blue">默认</Tag>}
                {b.protected && <Tag color="orange">受保护</Tag>}
                {b.merged && <Tag>已合并</Tag>}
              </Space>
            )
          },
          { title: '最近提交', ellipsis: true, render: (_, b) => b.commit?.title },
          { title: '作者', width: 120, render: (_, b) => b.commit?.author_name },
          {
            title: '更新时间',
            key: 'updated',
            width: 120,
            sorter: true,
            sortDirections: ['descend', 'ascend', 'descend'],
            sortOrder: sort === 'updated_desc' ? 'descend' : sort === 'updated_asc' ? 'ascend' : null,
            render: (_, b) => <TimeAgo value={b.commit?.committed_date} />
          },
          {
            title: '操作',
            width: 220,
            render: (_, b) => (
              <Space>
                <a onClick={() => update({ tab: 'code', ref: b.name, path: undefined, type: undefined })}>代码</a>
                <a onClick={() => update({ tab: 'commits', ref: b.name, path: undefined, type: undefined })}>提交</a>
                <a onClick={() => setRollback(b.name)}>回滚</a>
                {!b.default && !b.protected && (
                  <Popconfirm
                    title={`删除分支 ${b.name}？`}
                    description="删除后无法恢复"
                    onConfirm={() =>
                      run(
                        async () => {
                          await del(`/projects/${project.id}/repository/branches/${encodeURIComponent(b.name)}`)
                          setSelected((s) => s.filter((n) => n !== b.name))
                        },
                        '分支已删除',
                        [key, ['branches', project.id]]
                      )
                    }
                  >
                    <a style={{ color: '#ff4d4f' }}>删除</a>
                  </Popconfirm>
                )}
              </Space>
            )
          }
        ]}
      />
      <Modal title="新建分支" open={creating} onCancel={() => setCreating(false)} onOk={() => form.submit()} okText="创建">
        <Form form={form} layout="vertical" onFinish={create}>
          <Form.Item label="分支名" name="branch" rules={[{ required: true, message: '请填写分支名' }]}>
            <Input placeholder="例如 feature/login" />
          </Form.Item>
          <Form.Item label="基于" name="ref" rules={[{ required: true, message: '请选择来源分支' }]}>
            <RefSelect projectId={project.id} value={form.getFieldValue('ref')} onChange={(v) => form.setFieldsValue({ ref: v })} />
          </Form.Item>
        </Form>
      </Modal>
      {rollback && <RollbackModal projectId={project.id} branch={rollback} onClose={() => setRollback(undefined)} />}
    </>
  )
}

function TagsTab({ projectId, update }: { projectId: number; update: Update }) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const tags = useQuery({
    queryKey: ['tag-list', projectId, search, page],
    queryFn: ({ signal }) => getPage<RepoTag>(`/projects/${projectId}/repository/tags`, { search, page, per_page: 20 }, signal)
  })
  const data = tags.data?.data ?? []
  return (
    <>
      <Input.Search
        allowClear
        placeholder="搜索标签"
        style={{ width: 240, marginBottom: 16 }}
        onSearch={(v) => {
          setSearch(v)
          setPage(1)
        }}
      />
      <Table<RepoTag>
        rowKey="name"
        size="small"
        loading={tags.isLoading}
        dataSource={data}
        locale={{ emptyText: '还没有标签' }}
        pagination={{
          current: page,
          pageSize: 20,
          total: pageTotal(page, 20, data.length, tags.data?.total ?? null),
          onChange: setPage
        }}
        columns={[
          {
            title: '标签',
            render: (_, t) => <a onClick={() => update({ tab: 'code', ref: t.name, path: undefined, type: undefined })}>{t.name}</a>
          },
          { title: '说明', ellipsis: true, render: (_, t) => t.message || t.commit.title },
          { title: '提交', width: 100, render: (_, t) => <Typography.Text code>{t.commit.short_id}</Typography.Text> },
          { title: '时间', width: 110, render: (_, t) => <TimeAgo value={t.commit.committed_date} /> }
        ]}
      />
    </>
  )
}

function CloneBox({ project }: { project: Project }) {
  return (
    <Space direction="vertical" style={{ width: 420 }}>
      {project.ssh_url_to_repo && (
        <div>
          <div>SSH</div>
          <Typography.Text code copyable>
            {project.ssh_url_to_repo}
          </Typography.Text>
        </div>
      )}
      {project.http_url_to_repo && (
        <div>
          <div>HTTP(S)</div>
          <Typography.Text code copyable>
            {project.http_url_to_repo}
          </Typography.Text>
        </div>
      )}
    </Space>
  )
}

export default function ProjectDetailPage() {
  const navigate = useNavigate()
  const { id } = useParams()
  const projectId = Number(id)
  const [params, setParams] = useSearchParams()
  const project = useQuery({
    queryKey: ['project', projectId],
    queryFn: ({ signal }) => get<Project>(`/projects/${projectId}`, undefined, signal)
  })

  const p = project.data
  const tab = params.get('tab') ?? 'code'
  const refName = params.get('ref') ?? p?.default_branch ?? ''
  const path = params.get('path') ?? ''
  const type = params.get('type') ?? 'tree'

  const update: Update = (patch) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v)
      else next.delete(k)
    }
    setParams(next)
  }

  if (project.isLoading) return <Spin />
  if (project.error || !p) {
    return <Result status="404" title="打不开这个项目" subTitle={(project.error as Error)?.message} />
  }

  const empty = p.empty_repo || !p.default_branch

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
          <Space align="start">
            <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/projects')} />
            <div>
              <Space>
                <Typography.Title level={4} style={{ margin: 0 }}>
                  {p.name_with_namespace}
                </Typography.Title>
                {p.visibility && <Tag>{visibilityText[p.visibility] ?? p.visibility}</Tag>}
              </Space>
              {p.description && <Typography.Paragraph type="secondary" style={{ margin: '4px 0 0' }}>{p.description}</Typography.Paragraph>}
            </div>
          </Space>
          <Space wrap>
            {!empty && <CloneButton project={p} />}
            <Popover trigger="click" title="克隆仓库" content={<CloneBox project={p} />}>
              <Button icon={<CopyOutlined />}>克隆</Button>
            </Popover>
            <Button onClick={() => navigate(`/mrs?project=${p.id}`)}>合并请求</Button>
            <Button onClick={() => navigate(`/issues?project=${p.id}`)}>Issue</Button>
            <Button onClick={() => navigate(`/pipelines?project=${p.id}`)}>流水线</Button>
            <Button onClick={() => openExternal(p.web_url)}>网页</Button>
          </Space>
        </div>
      </Card>

      <Card>
        {empty ? (
          <Empty description="仓库还是空的，推送代码后即可在这里浏览" />
        ) : (
          <Tabs
            activeKey={tab}
            onChange={(k) => update({ tab: k })}
            items={[
              { key: 'code', label: '代码', children: <CodeTab project={p} refName={refName} path={path} type={type} update={update} /> },
              { key: 'commits', label: '提交记录', children: <CommitsTab projectId={p.id} refName={refName} path={path} update={update} /> },
              { key: 'branches', label: '分支', children: <BranchesTab project={p} refName={refName} update={update} /> },
              { key: 'tags', label: '标签', children: <TagsTab projectId={p.id} update={update} /> },
              { key: 'settings', label: '设置', children: <ProjectSettings project={p} /> }
            ]}
          />
        )}
      </Card>
    </Space>
  )
}
