import { useState } from 'react'
import { Button, Card, Checkbox, Form, Input, Modal, Segmented, Select, Space, Table, Tag } from 'antd'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { getPage, post, useAction, useMe } from '../api'
import { IssueState, TimeAgo } from '../labels'
import IssueDrawer from '../components/IssueDrawer'
import ProjectSelect from '../components/ProjectSelect'
import type { Issue } from '../types'

type Scope = 'assigned_to_me' | 'created_by_me' | 'all'

interface NewIssue {
  projectId: number
  title: string
  description?: string
  labels?: string
  assignToMe: boolean
}

export default function IssuesPage() {
  const me = useMe()
  const run = useAction()
  const [params, setParams] = useSearchParams()
  const projectId = params.get('project') ? Number(params.get('project')) : undefined
  const [scope, setScope] = useState<Scope>(projectId ? 'all' : 'assigned_to_me')
  const [state, setState] = useState('opened')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [open, setOpen] = useState<Issue>()
  const [creating, setCreating] = useState(false)
  const [form] = Form.useForm<NewIssue>()

  const path = projectId ? `/projects/${projectId}/issues` : '/issues'
  const issues = useQuery({
    queryKey: ['issues', path, scope, state, search, page, pageSize],
    queryFn: () =>
      getPage<Issue>(path, {
        scope,
        state: state === 'all' ? undefined : state,
        search,
        order_by: 'updated_at',
        page,
        per_page: pageSize
      })
  })

  const create = async (v: NewIssue) => {
    const ok = await run(
      () =>
        post(`/projects/${v.projectId}/issues`, {
          title: v.title,
          description: v.description,
          labels: v.labels,
          assignee_ids: v.assignToMe && me.data ? [me.data.id] : undefined
        }),
      'Issue 已创建',
      [['issues']]
    )
    if (ok) {
      setCreating(false)
      form.resetFields()
    }
  }

  return (
    <Card
      title="Issue"
      extra={
        <Button
          type="primary"
          onClick={() => {
            form.setFieldsValue({ projectId, assignToMe: true })
            setCreating(true)
          }}
        >
          新建 Issue
        </Button>
      }
    >
      <Space wrap style={{ marginBottom: 16 }}>
        <Segmented<Scope>
          value={scope}
          onChange={(v) => {
            setScope(v)
            setPage(1)
          }}
          options={[
            { label: '指派给我', value: 'assigned_to_me' },
            { label: '我创建的', value: 'created_by_me' },
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
            { value: 'opened', label: '未解决' },
            { value: 'closed', label: '已关闭' },
            { value: 'all', label: '全部状态' }
          ]}
        />
        <ProjectSelect
          allowClear
          value={projectId}
          placeholder="全部项目"
          onChange={(v) => {
            setParams(v ? { project: String(v) } : {})
            setPage(1)
          }}
        />
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
      <Table<Issue>
        rowKey="id"
        loading={issues.isLoading}
        dataSource={issues.data?.data}
        onRow={(r) => ({ onDoubleClick: () => setOpen(r) })}
        pagination={{
          current: page,
          pageSize,
          total: issues.data?.total ?? undefined,
          showTotal: (n) => `共 ${n} 条`,
          onChange: (p, s) => {
            setPage(p)
            setPageSize(s)
          }
        }}
        columns={[
          { title: '标题', render: (_, r) => <a onClick={() => setOpen(r)}>{r.title}</a> },
          { title: '编号', width: 220, render: (_, r) => r.references.full },
          { title: '标签', width: 200, render: (_, r) => r.labels.map((l) => <Tag key={l}>{l}</Tag>) },
          { title: '负责人', width: 120, render: (_, r) => r.assignees.map((a) => a.name).join('、') || '-' },
          { title: '状态', width: 80, render: (_, r) => <IssueState value={r.state} /> },
          { title: '评论', width: 60, dataIndex: 'user_notes_count' },
          { title: '更新', width: 100, dataIndex: 'updated_at', render: (v) => <TimeAgo value={v} /> }
        ]}
      />
      <IssueDrawer projectId={open?.project_id} iid={open?.iid} onClose={() => setOpen(undefined)} />
      <Modal title="新建 Issue" open={creating} onCancel={() => setCreating(false)} onOk={() => form.submit()} okText="创建" width={640}>
        <Form form={form} layout="vertical" onFinish={create}>
          <Form.Item label="项目" name="projectId" rules={[{ required: true, message: '请选择项目' }]}>
            <ProjectSelect />
          </Form.Item>
          <Form.Item label="标题" name="title" rules={[{ required: true, message: '请填写标题' }]}>
            <Input />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input.TextArea rows={6} placeholder="支持 Markdown" />
          </Form.Item>
          <Form.Item label="标签（多个用英文逗号分隔）" name="labels">
            <Input placeholder="例如 bug,紧急" />
          </Form.Item>
          <Form.Item name="assignToMe" valuePropName="checked">
            <Checkbox>指派给我</Checkbox>
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  )
}
