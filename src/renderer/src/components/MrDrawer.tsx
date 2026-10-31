import { useState } from 'react'
import { Button, Checkbox, Descriptions, Drawer, Empty, Modal, Space, Spin, Tabs, Tag } from 'antd'
import { useQuery } from '@tanstack/react-query'
import { ApiError, get, openExternal, post, put, useAction } from '../api'
import { MergeStatus, MrState, PipelineStatus, TimeAgo } from '../labels'
import Notes from './Notes'
import DiffList from './DiffList'
import AiReview from './AiReview'
import type { Diff, MergeRequest, User } from '../types'

interface Approvals {
  approved_by: { user: User }[]
  approvals_required?: number
  approvals_left?: number
}

async function loadDiffs(base: string): Promise<Diff[]> {
  try {
    return await get<Diff[]>(`${base}/diffs`, { per_page: 100 })
  } catch (e) {
    // GitLab < 15.7 没有 /diffs 接口
    if (e instanceof ApiError && e.status === 404) {
      return (await get<{ changes: Diff[] }>(`${base}/changes`)).changes
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
  const [tab, setTab] = useState('overview')
  const [mergeOpen, setMergeOpen] = useState(false)
  const [squash, setSquash] = useState(false)
  const [removeBranch, setRemoveBranch] = useState(true)
  const run = useAction()

  const mrKey = ['mr', projectId, iid]
  const approvalsKey = ['mr-approvals', projectId, iid]
  const mr = useQuery({ queryKey: mrKey, queryFn: () => get<MergeRequest>(base), enabled: open })
  const approvals = useQuery({
    queryKey: approvalsKey,
    queryFn: () => get<Approvals>(`${base}/approvals`),
    enabled: open,
    retry: false
  })
  const diffs = useQuery({
    queryKey: ['mr-diffs', projectId, iid],
    queryFn: () => loadDiffs(base),
    enabled: open && (tab === 'changes' || tab === 'ai')
  })

  const m = mr.data
  const refresh = [mrKey, approvalsKey, ['mrs'], ['notes', base], ['todos'], ['count']]

  const doMerge = async () => {
    const ok = await run(
      () => put(`${base}/merge`, { squash, should_remove_source_branch: removeBranch }),
      '已合并',
      refresh
    )
    if (ok) setMergeOpen(false)
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={900}
      destroyOnClose
      title={m ? `${m.references.full}  ${m.title}` : '合并请求'}
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
                <Button onClick={() => run(() => post(`${base}/approve`), '已批准', refresh)}>批准</Button>
                <Button onClick={() => run(() => post(`${base}/unapprove`), '已撤销批准', refresh)}>撤销批准</Button>
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
            <Button onClick={() => setTab('ai')}>AI 审核</Button>
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
                      <Descriptions.Item label="合并检查">
                        <MergeStatus value={m.detailed_merge_status} />
                      </Descriptions.Item>
                      <Descriptions.Item label="分支">
                        {m.source_branch} → {m.target_branch}
                      </Descriptions.Item>
                      <Descriptions.Item label="流水线">
                        {m.head_pipeline ? <PipelineStatus value={m.head_pipeline.status} /> : '无'}
                      </Descriptions.Item>
                      <Descriptions.Item label="作者">{m.author.name}</Descriptions.Item>
                      <Descriptions.Item label="审核人">
                        {m.reviewers?.map((u) => u.name).join('、') || '无'}
                      </Descriptions.Item>
                      <Descriptions.Item label="已批准">
                        {approvals.data?.approved_by.map((a) => a.user.name).join('、') || '暂无'}
                        {approvals.data?.approvals_left ? `（还需 ${approvals.data.approvals_left} 人）` : ''}
                      </Descriptions.Item>
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
                children: <Notes basePath={base} />
              },
              {
                key: 'changes',
                label: '变更',
                children: diffs.isLoading ? (
                  <Spin />
                ) : diffs.error ? (
                  <Empty description={(diffs.error as Error).message} />
                ) : (
                  <DiffList diffs={diffs.data ?? []} />
                )
              },
              {
                key: 'ai',
                label: 'AI 审核',
                children: (
                  <AiReview
                    base={base}
                    mr={m}
                    diffs={diffs.data}
                    diffsLoading={diffs.isLoading}
                    diffsError={diffs.error as Error | null}
                    invalidate={[['notes', base], mrKey]}
                  />
                )
              }
            ]}
          />

          <Modal title="合并请求" open={mergeOpen} onOk={doMerge} onCancel={() => setMergeOpen(false)} okText="确认合并">
            <Space direction="vertical">
              <span>
                将 <b>{m.source_branch}</b> 合并到 <b>{m.target_branch}</b>
              </span>
              <Checkbox checked={squash} onChange={(e) => setSquash(e.target.checked)}>
                压缩提交（Squash）
              </Checkbox>
              <Checkbox checked={removeBranch} onChange={(e) => setRemoveBranch(e.target.checked)}>
                合并后删除源分支
              </Checkbox>
            </Space>
          </Modal>
        </>
      )}
    </Drawer>
  )
}
