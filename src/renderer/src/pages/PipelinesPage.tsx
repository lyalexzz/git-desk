import { useState } from 'react'
import { Button, Card, Drawer, Empty, Form, Input, Modal, Select, Space, Spin, Table } from 'antd'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { get, getAll, getPage, openExternal, post, request, useAction } from '../api'
import { PipelineStatus, TimeAgo, formatDuration } from '../labels'
import ProjectSelect from '../components/ProjectSelect'
import type { Branch, Job, Pipeline } from '../types'

const ACTIVE = ['created', 'waiting_for_resource', 'preparing', 'pending', 'running']

function cleanLog(text: string): string {
  return text
    .replace(/section_(start|end):\d+:[^\r\n]*?\r/g, '')
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    .replace(/\r(?!\n)/g, '')
}

function JobLog({ projectId, job, onClose }: { projectId: number; job?: Job; onClose: () => void }) {
  const log = useQuery({
    queryKey: ['job-log', projectId, job?.id],
    queryFn: async () => cleanLog((await request<string>({ path: `/projects/${projectId}/jobs/${job!.id}/trace`, raw: true })).data),
    enabled: !!job,
    refetchInterval: job && ACTIVE.includes(job.status) ? 3000 : false
  })
  return (
    <Modal open={!!job} onCancel={onClose} footer={null} width="80%" title={job ? `作业日志：${job.name}` : ''} destroyOnClose>
      {log.isLoading ? <Spin /> : <pre className="job-log">{log.data || '（暂无日志）'}</pre>}
    </Modal>
  )
}

function PipelineDrawer({ projectId, pipeline, onClose }: { projectId: number; pipeline?: Pipeline; onClose: () => void }) {
  const run = useAction()
  const [logJob, setLogJob] = useState<Job>()
  const key = ['jobs', projectId, pipeline?.id]
  const jobs = useQuery({
    queryKey: key,
    queryFn: () => getAll<Job>(`/projects/${projectId}/pipelines/${pipeline!.id}/jobs`, { include_retried: false }),
    enabled: !!pipeline,
    refetchInterval: pipeline && ACTIVE.includes(pipeline.status) ? 5000 : false
  })
  const stages = [...new Set((jobs.data ?? []).slice().reverse().map((j) => j.stage))]

  return (
    <Drawer
      open={!!pipeline}
      onClose={onClose}
      width={860}
      title={pipeline ? `流水线 #${pipeline.id}（${pipeline.ref}）` : ''}
      extra={pipeline && <Button onClick={() => openExternal(pipeline.web_url)}>在浏览器打开</Button>}
    >
      {jobs.isLoading ? (
        <Spin />
      ) : (
        <Table<Job>
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={(jobs.data ?? []).slice().sort((a, b) => stages.indexOf(a.stage) - stages.indexOf(b.stage) || a.id - b.id)}
          columns={[
            { title: '阶段', dataIndex: 'stage', width: 120 },
            { title: '作业', dataIndex: 'name', render: (v, j) => <a onClick={() => setLogJob(j)}>{v}</a> },
            { title: '状态', width: 110, render: (_, j) => <PipelineStatus value={j.status} /> },
            { title: '耗时', width: 110, render: (_, j) => formatDuration(j.duration) },
            {
              title: '操作',
              width: 150,
              render: (_, j) => (
                <Space>
                  <a onClick={() => setLogJob(j)}>日志</a>
                  {j.status === 'manual' ? (
                    <a onClick={() => run(() => post(`/projects/${projectId}/jobs/${j.id}/play`), '已触发', [key, ['pipelines']])}>运行</a>
                  ) : ACTIVE.includes(j.status) ? (
                    <a onClick={() => run(() => post(`/projects/${projectId}/jobs/${j.id}/cancel`), '已取消', [key, ['pipelines']])}>取消</a>
                  ) : (
                    <a onClick={() => run(() => post(`/projects/${projectId}/jobs/${j.id}/retry`), '已重试', [key, ['pipelines']])}>重试</a>
                  )}
                </Space>
              )
            }
          ]}
        />
      )}
      <JobLog projectId={projectId} job={logJob} onClose={() => setLogJob(undefined)} />
    </Drawer>
  )
}

export default function PipelinesPage() {
  const run = useAction()
  const [params, setParams] = useSearchParams()
  const projectId = params.get('project') ? Number(params.get('project')) : undefined
  const [status, setStatus] = useState<string>()
  const [ref, setRef] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [open, setOpen] = useState<Pipeline>()
  const [creating, setCreating] = useState(false)
  const [branchSearch, setBranchSearch] = useState('')
  const [form] = Form.useForm<{ ref: string }>()

  const pipelines = useQuery({
    queryKey: ['pipelines', projectId, status, ref, page, pageSize],
    queryFn: () => getPage<Pipeline>(`/projects/${projectId}/pipelines`, { status, ref, page, per_page: pageSize }),
    enabled: projectId != null,
    refetchInterval: (q) => (q.state.data?.data.some((p) => ACTIVE.includes(p.status)) ? 10_000 : false)
  })
  const branches = useQuery({
    queryKey: ['branches', projectId, branchSearch],
    queryFn: () => get<Branch[]>(`/projects/${projectId}/repository/branches`, { search: branchSearch, per_page: 50 }),
    enabled: creating && projectId != null
  })

  const createPipeline = async (v: { ref: string }) => {
    const ok = await run(() => post(`/projects/${projectId}/pipeline`, { ref: v.ref }), '流水线已启动', [['pipelines']])
    if (ok) setCreating(false)
  }

  return (
    <Card
      title="CI/CD 流水线"
      extra={
        <Space>
          <Button onClick={() => void pipelines.refetch()} disabled={projectId == null} loading={pipelines.isFetching}>
            刷新
          </Button>
          <Button type="primary" disabled={projectId == null} onClick={() => setCreating(true)}>
            运行流水线
          </Button>
        </Space>
      }
    >
      <Space wrap style={{ marginBottom: 16 }}>
        <ProjectSelect
          value={projectId}
          onChange={(v) => {
            setParams(v ? { project: String(v) } : {})
            setPage(1)
          }}
        />
        <Select
          allowClear
          placeholder="全部状态"
          style={{ width: 130 }}
          value={status}
          onChange={(v) => {
            setStatus(v)
            setPage(1)
          }}
          options={[
            { value: 'running', label: '运行中' },
            { value: 'pending', label: '排队中' },
            { value: 'success', label: '成功' },
            { value: 'failed', label: '失败' },
            { value: 'canceled', label: '已取消' },
            { value: 'manual', label: '待手动触发' }
          ]}
        />
        <Input.Search
          allowClear
          placeholder="按分支/标签筛选"
          style={{ width: 200 }}
          onSearch={(v) => {
            setRef(v)
            setPage(1)
          }}
        />
      </Space>
      {projectId == null ? (
        <Empty description="请先选择一个项目" />
      ) : (
        <Table<Pipeline>
          rowKey="id"
          loading={pipelines.isLoading}
          dataSource={pipelines.data?.data}
          onRow={(p) => ({ onDoubleClick: () => setOpen(p) })}
          pagination={{
            current: page,
            pageSize,
            total: pipelines.data?.total ?? undefined,
            showTotal: (n) => `共 ${n} 条`,
            onChange: (p, s) => {
              setPage(p)
              setPageSize(s)
            }
          }}
          columns={[
            { title: 'ID', width: 100, render: (_, p) => <a onClick={() => setOpen(p)}>#{p.id}</a> },
            { title: '状态', width: 110, render: (_, p) => <PipelineStatus value={p.status} /> },
            { title: '分支/标签', dataIndex: 'ref' },
            { title: '提交', width: 100, render: (_, p) => p.sha.slice(0, 8) },
            { title: '来源', width: 120, dataIndex: 'source' },
            { title: '创建', width: 110, dataIndex: 'created_at', render: (v) => <TimeAgo value={v} /> },
            {
              title: '操作',
              width: 140,
              render: (_, p) => (
                <Space>
                  <a onClick={() => setOpen(p)}>作业</a>
                  {ACTIVE.includes(p.status) ? (
                    <a onClick={() => run(() => post(`/projects/${projectId}/pipelines/${p.id}/cancel`), '已取消', [['pipelines']])}>取消</a>
                  ) : (
                    <a onClick={() => run(() => post(`/projects/${projectId}/pipelines/${p.id}/retry`), '已重试', [['pipelines']])}>重试</a>
                  )}
                </Space>
              )
            }
          ]}
        />
      )}
      {projectId != null && <PipelineDrawer projectId={projectId} pipeline={open} onClose={() => setOpen(undefined)} />}
      <Modal title="运行流水线" open={creating} onCancel={() => setCreating(false)} onOk={() => form.submit()} okText="运行">
        <Form form={form} layout="vertical" onFinish={createPipeline}>
          <Form.Item label="分支" name="ref" rules={[{ required: true, message: '请选择分支' }]}>
            <Select
              showSearch
              filterOption={false}
              onSearch={setBranchSearch}
              loading={branches.isFetching}
              options={(branches.data ?? []).map((b) => ({ value: b.name, label: b.default ? `${b.name}（默认）` : b.name }))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  )
}
