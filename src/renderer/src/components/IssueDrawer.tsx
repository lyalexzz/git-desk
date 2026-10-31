import { Button, Descriptions, Drawer, Space, Spin, Tag } from 'antd'
import { useQuery } from '@tanstack/react-query'
import { get, openExternal, put, useAction, useMe } from '../api'
import { IssueState, TimeAgo } from '../labels'
import Notes from './Notes'
import type { Issue } from '../types'

export default function IssueDrawer({
  projectId,
  iid,
  onClose
}: {
  projectId?: number
  iid?: number
  onClose: () => void
}) {
  const open = projectId != null && iid != null
  const base = `/projects/${projectId}/issues/${iid}`
  const key = ['issue', projectId, iid]
  const issue = useQuery({ queryKey: key, queryFn: ({ signal }) => get<Issue>(base, undefined, signal), enabled: open })
  const me = useMe()
  const run = useAction()
  const refresh = [key, ['issues'], ['notes', base], ['todos'], ['count']]
  const i = issue.data

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={820}
      destroyOnClose
      title={i ? `${i.references.full}  ${i.title}` : 'Issue'}
      extra={i && <Button onClick={() => openExternal(i.web_url)}>在浏览器打开</Button>}
    >
      {!i ? (
        <Spin />
      ) : (
        <>
          <Space wrap style={{ marginBottom: 16 }}>
            {i.state === 'opened' ? (
              <Button danger onClick={() => run(() => put(base, { state_event: 'close' }), '已关闭', refresh)}>
                关闭 Issue
              </Button>
            ) : (
              <Button onClick={() => run(() => put(base, { state_event: 'reopen' }), '已重新打开', refresh)}>
                重新打开
              </Button>
            )}
            {me.data && !i.assignees.some((a) => a.id === me.data.id) && (
              <Button
                onClick={() =>
                  run(
                    () => put(base, { assignee_ids: [...i.assignees.map((a) => a.id), me.data.id] }),
                    '已指派给我',
                    refresh
                  )
                }
              >
                指派给我
              </Button>
            )}
          </Space>
          <Descriptions column={2} bordered size="small">
            <Descriptions.Item label="状态">
              <IssueState value={i.state} />
            </Descriptions.Item>
            <Descriptions.Item label="作者">{i.author.name}</Descriptions.Item>
            <Descriptions.Item label="负责人">{i.assignees.map((a) => a.name).join('、') || '未指派'}</Descriptions.Item>
            <Descriptions.Item label="里程碑">{i.milestone?.title ?? '无'}</Descriptions.Item>
            <Descriptions.Item label="截止日期">{i.due_date ?? '无'}</Descriptions.Item>
            <Descriptions.Item label="更新时间">
              <TimeAgo value={i.updated_at} />
            </Descriptions.Item>
            <Descriptions.Item label="标签" span={2}>
              {i.labels.length ? i.labels.map((l) => <Tag key={l}>{l}</Tag>) : '无'}
            </Descriptions.Item>
          </Descriptions>
          <h4 style={{ marginTop: 16 }}>描述</h4>
          <pre className="pre-text">{i.description || '（无描述）'}</pre>
          <h4 style={{ marginTop: 16 }}>评论</h4>
          <Notes basePath={base} />
        </>
      )}
    </Drawer>
  )
}
