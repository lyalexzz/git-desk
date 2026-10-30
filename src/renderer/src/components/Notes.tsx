import { useState } from 'react'
import { Button, Empty, Input, List, Space, Spin, Typography } from 'antd'
import { useQuery } from '@tanstack/react-query'
import { getAll, post, useAction } from '../api'
import { TimeAgo } from '../labels'
import type { Note } from '../types'

/** 合并请求 / Issue 的评论区；basePath 形如 /projects/1/merge_requests/2 */
export default function Notes({ basePath }: { basePath: string }) {
  const [text, setText] = useState('')
  const [showSystem, setShowSystem] = useState(false)
  const run = useAction()
  const key = ['notes', basePath]
  const notes = useQuery({
    queryKey: key,
    queryFn: () => getAll<Note>(`${basePath}/notes`, { sort: 'asc', order_by: 'created_at' })
  })

  const visible = (notes.data ?? []).filter((n) => showSystem || !n.system)

  const submit = async () => {
    if (!text.trim()) return
    const ok = await run(() => post(`${basePath}/notes`, { body: text }), '评论已发布', [key])
    if (ok) setText('')
  }

  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <Button size="small" type="link" onClick={() => setShowSystem(!showSystem)} style={{ padding: 0 }}>
        {showSystem ? '隐藏系统动态' : '显示系统动态'}
      </Button>
      {notes.isLoading ? (
        <Spin />
      ) : visible.length === 0 ? (
        <Empty description="暂无评论" />
      ) : (
        <List
          dataSource={visible}
          renderItem={(n) => (
            <List.Item>
              <List.Item.Meta
                title={
                  <Space>
                    <span>{n.author.name}</span>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      <TimeAgo value={n.created_at} />
                    </Typography.Text>
                  </Space>
                }
                description={
                  <pre className="pre-text" style={{ color: n.system ? '#8c8c8c' : undefined }}>
                    {n.body}
                  </pre>
                }
              />
            </List.Item>
          )}
        />
      )}
      <Input.TextArea
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="写评论，支持 Markdown"
      />
      <Button type="primary" onClick={submit} disabled={!text.trim()}>
        发表评论
      </Button>
    </Space>
  )
}
