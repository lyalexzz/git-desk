import { useEffect, useState } from 'react'
import { Button, Checkbox, Descriptions, Drawer, Empty, Form, Input, Modal, Space, Spin, Tabs, Tag } from 'antd'
import { useQuery } from '@tanstack/react-query'
import { ApiError, get, getAll, openExternal, post, put, useAction, useMe } from '../api'
import { MergeStatus, MrState, PipelineStatus, TimeAgo, mrLabel } from '../labels'
import MrDiscussions from './MrDiscussions'
import DiffList from './DiffList'
import AiReview from './AiReview'
import type { Diff, Discussion, MergeRequest, User } from '../types'

interface Approvals {
  approved_by: { user: User }[]
  approvals_required?: number
  approvals_left?: number
}

interface EditForm {
  title: string
  description: string
  draft: boolean
  assignToMe: boolean
}

async function loadDiffs(base: string, signal?: AbortSignal): Promise<Diff[]> {
  try {
    return await getAll<Diff>(`${base}/diffs`, {}, 10, signal)
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      return (await get<{ changes: Diff[] }>(`${base}/changes`, undefined, signal)).changes
    }
    throw e
  }
}

export default function MrDrawer({
  projectId,
  iid,
  onClose
}: {
  projectId?: number
  iid?: number
  onClose: () => void
}) {
  const open = projectId != null && iid != null
  const base = `/projects/${projectId}/merge_requests/${iid}`
  const me = useMe()
  const cfg = useQuery({ queryKey: ['config'], queryFn: () => window.desktop.getConfig() })
  const caps = cfg.data?.capabilities
  const titleWord = mrLabel(cfg.data?.provider || 'gitlab')
  const [tab, setTab] = useState('overview')
  const [mergeOpen, setMergeOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [squash, setSquash] = useState(false)
  const [removeBranch, setRemoveBranch] = useState(true)
  const [form] = Form.useForm<EditForm>()
  const run = useAction()

  const mrKey = ['mr', projectId, iid]
  const approvalsKey = ['mr-approvals', projectId, iid]
  const discussionsKey = ['discussions', base]
  const mr = useQuery({ queryKey: mrKey, queryFn: ({ signal }) => get<MergeRequest>(base, undefined, signal), enabled: open })
  const approvals = useQuery({
    queryKey: approvalsKey,
    queryFn: ({ signal }) => get<Approvals>(`${base}/approvals`, undefined, signal),
    enabled: open && Boolean(caps?.mrApprovals),
    retry: false
  })
  const diffs = useQuery({
    queryKey: ['mr-diffs', projectId, iid],
    queryFn: ({ signal }) => loadDiffs(base, signal),
    enabled: open && (tab === 'changes' || tab === 'ai')
  })
  const discussions = useQuery({
    queryKey: discussionsKey,
    queryFn: ({ signal }) => getAll<Discussion>(`${base}/discussions`, {}, 10, signal),
    enabled: open && (tab === 'changes' || tab === 'notes')
  })

  const m = mr.data
  const refresh = [mrKey, approvalsKey, discussionsKey, ['mrs'], ['notes', base], ['todos'], ['count']]

  useEffect(() => {
    if (!editOpen || !m) return
    form.setFieldsValue({
      title: m.title.replace(/^Draft:\s*/i, ''),
      description: m.description ?? '',
      draft: Boolean(m.draft),
      assignToMe: m.assignees.some((a) => a.id === me.data?.id)
    })
  }, [editOpen, m, me.data?.id, form])

  const doMerge = async () => {
    const ok = await run(
      () => put(`${base}/merge`, { squash, should_remove_source_branch: removeBranch }),
      '已合并',
      refresh
    )
    if (ok) setMergeOpen(false)
  }

  const saveEdit = async () => {
    const v = await form.validateFields()
    const bare = v.title.replace(/^Draft:\s*/i, '')
    const ok = await run(
      () =>
        put(base, {
          title: v.draft ? `Draft: ${bare}` : bare,
          description: v.description,
          assignee_ids: v.assignToMe && me.data ? [me.data.id] : []
        }),
      '已保存',
      refresh
    )
    if (ok) setEditOpen(false)
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={900}
      destroyOnClose
      title={m ? `${m.references.full}  ${m.title}` : titleWord}
      extra={m && <Button onClick={() => openExternal(m.web_url)}>在浏览器打开</Button>}
    >
      {!m ? (
        <Spin />
      ) : (
        <>
          <Space wrap style={{ marginBottom: 16 }}>
            {m.state === 'opened' && (
              <>
                <Button type="primary" onClick={() => setMergeOpen(true)}>
                  合并
                </Button>
                {caps?.mrApprovals && (
                  <>
                    <Button onClick={() => run(() => post(`${base}/approve`), '已批准', refresh)}>批准</Button>
                    <Button onClick={() => run(() => post(`${base}/unapprove`), '已撤销批准', refresh)}>撤销批准</Button>
                  </>
                )}
                <Button onClick={() => setEditOpen(true)}>编辑</Button>
                <Button danger onClick={() => run(() => put(base, { state_event: 'close' }), '已关闭', refresh)}>
                  关闭
                </Button>
              </>
            )}
            {m.state === 'closed' && (
              <Button onClick={() => run(() => put(base, { state_event: 'reopen' }), '已重新打开', refresh)}>
                重新打开
              </Button>
            )}
            {caps?.aiReview && <Button onClick={() => setTab('ai')}>AI 审核</Button>}
          </Space>

          <Tabs
            activeKey={tab}
            onChange={setTab}
            items={[
              {
                key: 'overview',
                label: '概览',
                children: (
                  <>
                    <Descriptions column={2} bordered size="small">
                      <Descriptions.Item label="状态">
                        <MrState value={m.state} /> {m.draft && <Tag>草稿</Tag>}
                      </Descriptions.Item>
                      {caps?.pipelines !== false && cfg.data?.provider !== 'github' && (
                        <Descriptions.Item label="合并检查">
                          <MergeStatus value={m.detailed_merge_status} />
                        </Descriptions.Item>
                      )}
                      <Descriptions.Item label="分支">
                        {m.source_branch} → {m.target_branch}
                      </Descriptions.Item>
                      {caps?.pipelines && (
                        <Descriptions.Item label="流水线">
                          {m.head_pipeline ? <PipelineStatus value={m.head_pipeline.status} /> : '无'}
                        </Descriptions.Item>
                      )}
                      <Descriptions.Item label="作者">{m.author.name}</Descriptions.Item>
                      <Descriptions.Item label="指派人">
                        {m.assignees.map((u) => u.name).join('、') || '无'}
                      </Descriptions.Item>
                      <Descriptions.Item label="审核人">
                        {m.reviewers?.map((u) => u.name).join('、') || '无'}
                      </Descriptions.Item>
                      {caps?.mrApprovals && (
                        <Descriptions.Item label="已批准">
                          {approvals.data?.approved_by.map((a) => a.user.name).join('、') || '暂无'}
                          {approvals.data?.approvals_left ? `（还需 ${approvals.data.approvals_left} 人）` : ''}
                        </Descriptions.Item>
                      )}
                      <Descriptions.Item label="更新时间">
                        <TimeAgo value={m.updated_at} />
                      </Descriptions.Item>
                    </Descriptions>
                    <h4 style={{ marginTop: 16 }}>描述</h4>
                    <pre className="pre-text">{m.description || '（无描述）'}</pre>
                  </>
                )
              },
              {
                key: 'notes',
                label: `讨论（${m.user_notes_count}）`,
                children: <MrDiscussions basePath={base} />
              },
              {
                key: 'changes',
                label: '变更',
                children: diffs.isLoading ? (
                  <Spin />
                ) : diffs.error ? (
                  <Empty description={(diffs.error as Error).message} />
                ) : (
                  <DiffList
                    diffs={diffs.data ?? []}
                    basePath={base}
                    diffRefs={m.diff_refs}
                    discussions={discussions.data ?? []}
                  />
                )
              },
              caps?.aiReview
                ? {
                    key: 'ai',
                    label: 'AI 审核',
                    children: (
                      <AiReview
                        base={base}
                        mr={m}
                        diffs={diffs.data}
                        diffsLoading={diffs.isLoading}
                        diffsError={diffs.error as Error | null}
                        invalidate={[['notes', base], discussionsKey, mrKey]}
                      />
                    )
                  }
                : null
            ].filter(Boolean) as { key: string; label: string; children: React.ReactNode }[]}
          />

          <Modal title={titleWord} open={mergeOpen} onOk={doMerge} onCancel={() => setMergeOpen(false)} okText="确认合并">
            <Space direction="vertical">
              <span>
                将 <b>{m.source_branch}</b> 合并到 <b>{m.target_branch}</b>
              </span>
              <Checkbox checked={squash} onChange={(e) => setSquash(e.target.checked)}>
                压缩提交（Squash）
              </Checkbox>
              {cfg.data?.provider !== 'github' && (
                <Checkbox checked={removeBranch} onChange={(e) => setRemoveBranch(e.target.checked)}>
                  合并后删除源分支
                </Checkbox>
              )}
            </Space>
          </Modal>

          <Modal title={`编辑${titleWord}`} open={editOpen} onOk={() => void saveEdit()} onCancel={() => setEditOpen(false)} okText="保存">
            <Form form={form} layout="vertical">
              <Form.Item label="标题" name="title" rules={[{ required: true, message: '请填写标题' }]}>
                <Input />
              </Form.Item>
              <Form.Item label="描述" name="description">
                <Input.TextArea rows={6} placeholder="支持 Markdown" />
              </Form.Item>
              <Form.Item name="draft" valuePropName="checked">
                <Checkbox>草稿</Checkbox>
              </Form.Item>
              <Form.Item name="assignToMe" valuePropName="checked">
                <Checkbox>指派给我</Checkbox>
              </Form.Item>
            </Form>
          </Modal>
        </>
      )}
    </Drawer>
  )
}
