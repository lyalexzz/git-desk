import { useState } from 'react'
import { Button, Card, Popconfirm, Space, Table, Tag } from 'antd'
import { useQuery } from '@tanstack/react-query'
import { getPage, openExternal, post, useAction } from '../api'
import { TimeAgo, targetType, todoAction } from '../labels'
import MrDrawer from '../components/MrDrawer'
import IssueDrawer from '../components/IssueDrawer'
import type { Todo } from '../types'

export default function TodosPage() {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [mr, setMr] = useState<{ projectId: number; iid: number }>()
  const [issue, setIssue] = useState<{ projectId: number; iid: number }>()
  const run = useAction()
  const key = ['todos', page, pageSize]
  const todos = useQuery({
    queryKey: key,
    queryFn: () => getPage<Todo>('/todos', { state: 'pending', page, per_page: pageSize })
  })

  const openTodo = (t: Todo) => {
    const projectId = t.project?.id ?? t.target?.project_id
    const iid = t.target?.iid
    if (projectId != null && iid != null && t.target_type === 'MergeRequest') setMr({ projectId, iid })
    else if (projectId != null && iid != null && t.target_type === 'Issue') setIssue({ projectId, iid })
    else openExternal(t.target_url)
  }

  return (
    <Card
      title="待办事项"
      extra={
        <Popconfirm title="把所有待办标记为已完成？" onConfirm={() => run(() => post('/todos/mark_as_done'), '已全部完成', [['todos'], ['count']])}>
          <Button>全部标记完成</Button>
        </Popconfirm>
      }
    >
      <Table<Todo>
        rowKey="id"
        loading={todos.isLoading}
        dataSource={todos.data?.data}
        onRow={(t) => ({ onDoubleClick: () => openTodo(t) })}
        pagination={{
          current: page,
          pageSize,
          total: todos.data?.total ?? undefined,
          showTotal: (n) => `共 ${n} 条`,
          onChange: (p, s) => {
            setPage(p)
            setPageSize(s)
          }
        }}
        columns={[
          { title: '时间', dataIndex: 'created_at', width: 110, render: (v) => <TimeAgo value={v} /> },
          { title: '来自', width: 110, render: (_, t) => t.author.name },
          { title: '事项', width: 130, render: (_, t) => <Tag color="blue">{todoAction[t.action_name] ?? t.action_name}</Tag> },
          {
            title: '内容',
            render: (_, t) => (
              <a onClick={() => openTodo(t)}>
                [{targetType[t.target_type] ?? t.target_type}] {t.target?.title ?? t.body}
              </a>
            )
          },
          { title: '项目', width: 240, render: (_, t) => t.project?.name_with_namespace ?? '-' },
          {
            title: '操作',
            width: 110,
            render: (_, t) => (
              <Space>
                <a onClick={() => run(() => post(`/todos/${t.id}/mark_as_done`), '已完成', [['todos'], ['count']])}>标记完成</a>
              </Space>
            )
          }
        ]}
      />
      <MrDrawer projectId={mr?.projectId} iid={mr?.iid} onClose={() => setMr(undefined)} />
      <IssueDrawer projectId={issue?.projectId} iid={issue?.iid} onClose={() => setIssue(undefined)} />
    </Card>
  )
}
