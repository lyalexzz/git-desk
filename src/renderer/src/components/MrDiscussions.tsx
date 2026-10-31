import { useState } from 'react'
import { Button, Empty, Input, Space, Spin, Tag, Typography } from 'antd'
import { useQuery } from '@tanstack/react-query'
import { getAll, post, put, useAction } from '../api'
import { TimeAgo } from '../labels'
import type { Discussion } from '../types'

function positionHint(d: Discussion): string | null {
  const pos = d.notes[0]?.position
  if (!pos || pos.position_type !== 'text') return null
  const line = pos.new_line ?? pos.old_line
  const path = pos.new_path || pos.old_path
  return line != null ? `${path}:${line}` : path
}

/** 合并请求讨论串：总评、回复、解决；行内讨论也会出现在这里 */
export default function MrDiscussions({ basePath }: { basePath: string }) {
  const [text, setText] = useState('')
  const [replyId, setReplyId] = useState<string | null>(null)
  const [replyText, setReplyText] = useState('')
  const [showSystem, setShowSystem] = useState(false)
  const run = useAction()
  const key = ['discussions', basePath]
  const discussions = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => getAll<Discussion>(`${basePath}/discussions`, {}, 10, signal)
  })

  const list = (discussions.data ?? []).filter((d) => {
    if (showSystem) return true
    return d.notes.some((n) => !n.system)
  })

  const submit = async () => {
    if (!text.trim()) return
    const ok = await run(() => post(`${basePath}/discussions`, { body: text }), '评论已发布', [key, ['notes', basePath]])
    if (ok) setText('')
  }

  const reply = async (id: string) => {
    if (!replyText.trim()) return
    const ok = await run(
      () => post(`${basePath}/discussions/${id}/notes`, { body: replyText }),
      '已回复',
      [key, ['notes', basePath]]
    )
    if (ok) {
      setReplyId(null)
      setReplyText('')
    }
  }

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Button size="small" type="link" onClick={() => setShowSystem(!showSystem)} style={{ padding: 0 }}>
        {showSystem ? '隐藏系统动态' : '显示系统动态'}
      </Button>
      {discussions.isLoading ? (
        <Spin />
      ) : list.length === 0 ? (
        <Empty description="暂无讨论" />
      ) : (
        list.map((d) => {
          const first = d.notes[0]
          const hint = positionHint(d)
          const resolvable = first?.resolvable
          const resolved = first?.resolved
          return (
            <div key={d.id} style={{ border: '1px solid #f0f0f0', borderRadius: 6, padding: 12 }}>
              <Space wrap style={{ marginBottom: 8 }}>
                {hint && <Tag>{hint}</Tag>}
                {resolvable && (resolved ? <Tag color="success">已解决</Tag> : <Tag color="warning">未解决</Tag>)}
                {resolvable && (
                  <Button
                    size="small"
                    type="link"
                    onClick={() =>
                      run(
                        () => put(`${basePath}/discussions/${d.id}`, { resolved: !resolved }),
                        resolved ? '已重新打开' : '已标记为解决',
                        [key]
                      )
                    }
                  >
                    {resolved ? '重新打开' : '解决'}
                  </Button>
                )}
              </Space>
              {d.notes
                .filter((n) => showSystem || !n.system)
                .map((n) => (
                  <div key={n.id} style={{ marginBottom: 10 }}>
                    <Space>
                      <Typography.Text strong>{n.author.name}</Typography.Text>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        <TimeAgo value={n.created_at} />
                      </Typography.Text>
                    </Space>
                    <pre className="pre-text" style={{ color: n.system ? '#8c8c8c' : undefined, marginTop: 4 }}>
                      {n.body}
                    </pre>
                  </div>
                ))}
              {replyId === d.id ? (
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Input.TextArea rows={2} value={replyText} onChange={(e) => setReplyText(e.target.value)} placeholder="回复…" />
                  <Space>
                    <Button type="primary" size="small" onClick={() => void reply(d.id)} disabled={!replyText.trim()}>
                      发送
                    </Button>
                    <Button size="small" onClick={() => setReplyId(null)}>
                      取消
                    </Button>
                  </Space>
                </Space>
              ) : (
                <Button size="small" type="link" style={{ padding: 0 }} onClick={() => setReplyId(d.id)}>
                  回复
                </Button>
              )}
            </div>
          )
        })
      )}
      <Input.TextArea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="发表总评，支持 Markdown" />
      <Button type="primary" onClick={submit} disabled={!text.trim()}>
        发表评论
      </Button>
    </Space>
  )
}
