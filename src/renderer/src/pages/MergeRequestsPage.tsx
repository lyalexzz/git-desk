import { useState } from 'react'
import { Button, Card, Input, Segmented, Select, Space, Table, Tag } from 'antd'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { getPage, useMe } from '../api'
import { MergeStatus, MrState, TimeAgo } from '../labels'
import CreateMrModal from '../components/CreateMrModal'
import MrDrawer from '../components/MrDrawer'
import ProjectSelect from '../components/ProjectSelect'
import type { MergeRequest } from '../types'

type Scope = 'review' | 'assigned_to_me' | 'created_by_me' | 'all'

export default function MergeRequestsPage() {
  const me = useMe()
  const [params, setParams] = useSearchParams()
  const projectId = params.get('project') ? Number(params.get('project')) : undefined
  const scope = (params.get('scope') as Scope) || (projectId ? 'all' : 'review')
  const [state, setState] = useState('opened')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [open, setOpen] = useState<MergeRequest>()
  const [creating, setCreating] = useState(false)

  const setParam = (k: string, v?: string) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v)
    else next.delete(k)
    setParams(next)
    setPage(1)
  }

  const path = projectId ? `/projects/${projectId}/merge_requests` : '/merge_requests'
  const mrs = useQuery({
    queryKey: ['mrs', path, scope, state, search, page, pageSize, me.data?.username],
    queryFn: ({ signal }) =>
      getPage<MergeRequest>(
        path,
        {
          scope: scope === 'review' ? 'all' : scope,
          reviewer_username: scope === 'review' ? me.data?.username : undefined,
          state: state === 'all' ? undefined : state,
          search,
          order_by: 'updated_at',
          page,
          per_page: pageSize
        },
        signal
      ),
    enabled: scope !== 'review' || !!me.data
  })

  return (
    <Card
      title="合并请求"
      extra={
        <Space>
          <Button type="primary" onClick={() => setCreating(true)}>
            新建合并请求
          </Button>
          <Button onClick={() => void mrs.refetch()} loading={mrs.isFetching}>
            刷新
          </Button>
        </Space>
      }
    >
      <Space wrap style={{ marginBottom: 16 }}>
        <Segmented<Scope>
          value={scope}
          onChange={(v) => setParam('scope', v)}
          options={[
            { label: '待我审核', value: 'review' },
            { label: '指派给我', value: 'assigned_to_me' },
            { label: '我发起的', value: 'created_by_me' },
            { label: '全部', value: 'all' }
          ]}
        />
        <Select
          value={state}
          style={{ width: 110 }}
          onChange={(v) => {
            setState(v)
            setPage(1)
          }}
          options={[
            { value: 'opened', label: '进行中' },
            { value: 'merged', label: '已合并' },
            { value: 'closed', label: '已关闭' },
            { value: 'all', label: '全部状态' }
          ]}
        />
        <ProjectSelect allowClear value={projectId} onChange={(v) => setParam('project', v?.toString())} placeholder="全部项目" />
        <Input.Search
          allowClear
          placeholder="搜索标题或描述"
          style={{ width: 220 }}
          onSearch={(v) => {
            setSearch(v)
            setPage(1)
          }}
        />
      </Space>
      <Table<MergeRequest>
        rowKey="id"
        loading={mrs.isLoading}
        dataSource={mrs.data?.data}
        onRow={(r) => ({ onDoubleClick: () => setOpen(r) })}
        pagination={{
          current: page,
          pageSize,
          total: mrs.data?.total ?? undefined,
          showTotal: (n) => `共 ${n} 条`,
          onChange: (p, s) => {
            setPage(p)
            setPageSize(s)
          }
        }}
        columns={[
          {
            title: '标题',
            render: (_, r) => (
              <Space>
                {r.draft && <Tag>草稿</Tag>}
                <a onClick={() => setOpen(r)}>{r.title}</a>
              </Space>
            )
          },
          { title: '编号', width: 220, render: (_, r) => r.references.full },
          { title: '作者', width: 100, render: (_, r) => r.author.name },
          { title: '分支', width: 220, render: (_, r) => `${r.source_branch} → ${r.target_branch}` },
          { title: '状态', width: 80, render: (_, r) => <MrState value={r.state} /> },
          { title: '合并检查', width: 120, render: (_, r) => (r.state === 'opened' ? <MergeStatus value={r.detailed_merge_status} /> : '-') },
          { title: '评论', width: 60, dataIndex: 'user_notes_count' },
          { title: '更新', width: 100, dataIndex: 'updated_at', render: (v) => <TimeAgo value={v} /> }
        ]}
      />
      <MrDrawer projectId={open?.project_id} iid={open?.iid} onClose={() => setOpen(undefined)} />
      <CreateMrModal
        open={creating}
        defaultProjectId={projectId}
        onClose={() => setCreating(false)}
        onCreated={(mr) => setOpen(mr)}
      />
    </Card>
  )
}
