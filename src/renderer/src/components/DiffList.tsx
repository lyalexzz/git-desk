import { useMemo, useState } from 'react'
import { Button, Collapse, Empty, Input, Space, Tag, Typography } from 'antd'
import { useQueryClient } from '@tanstack/react-query'
import { post, put, useAction } from '../api'
import { TimeAgo } from '../labels'
import type { Diff, DiffRefs, Discussion, DiscussionNote } from '../types'

interface DiffLine {
  type: 'hunk' | 'add' | 'del' | 'ctx' | 'meta'
  text: string
  oldLine: number | null
  newLine: number | null
}

function parseDiffLines(diff: string): DiffLine[] {
  const lines: DiffLine[] = []
  let oldLine = 0
  let newLine = 0
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('@@')) {
      const m = raw.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s*@@/)
      if (m) {
        oldLine = Number(m[1])
        newLine = Number(m[2])
      }
      lines.push({ type: 'hunk', text: raw, oldLine: null, newLine: null })
      continue
    }
    if (raw.startsWith('+++') || raw.startsWith('---') || raw.startsWith('diff ') || raw.startsWith('index ')) {
      lines.push({ type: 'meta', text: raw, oldLine: null, newLine: null })
      continue
    }
    if (raw.startsWith('+')) {
      lines.push({ type: 'add', text: raw, oldLine: null, newLine })
      newLine++
      continue
    }
    if (raw.startsWith('-')) {
      lines.push({ type: 'del', text: raw, oldLine, newLine: null })
      oldLine++
      continue
    }
    lines.push({ type: 'ctx', text: raw || ' ', oldLine, newLine })
    oldLine++
    newLine++
  }
  return lines
}

function countLines(diff: string): [number, number] {
  let add = 0
  let del = 0
  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) add++
    else if (line.startsWith('-') && !line.startsWith('---')) del++
  }
  return [add, del]
}

function lineKey(path: string, oldLine: number | null, newLine: number | null): string {
  return `${path}|${oldLine ?? ''}|${newLine ?? ''}`
}

function matchDiscussion(d: Discussion, path: string, oldLine: number | null, newLine: number | null): boolean {
  const pos = d.notes[0]?.position
  if (!pos || pos.position_type !== 'text') return false
  const p = pos.new_path || pos.old_path
  if (p !== path) return false
  if (newLine != null && pos.new_line === newLine) return true
  if (oldLine != null && pos.old_line === oldLine && (pos.new_line == null || newLine == null)) return true
  return pos.old_line === oldLine && pos.new_line === newLine
}

function Thread({
  discussion,
  basePath,
  onDone
}: {
  discussion: Discussion
  basePath: string
  onDone: () => void
}) {
  const run = useAction()
  const [reply, setReply] = useState('')
  const [open, setOpen] = useState(false)
  const first = discussion.notes[0]
  return (
    <div className="diff-thread">
      {discussion.notes.map((n: DiscussionNote) => (
        <div key={n.id} style={{ marginBottom: 6 }}>
          <Typography.Text strong style={{ fontSize: 12 }}>
            {n.author.name}
          </Typography.Text>{' '}
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            <TimeAgo value={n.created_at} />
          </Typography.Text>
          <pre className="pre-text" style={{ fontSize: 12, marginTop: 2 }}>
            {n.body}
          </pre>
        </div>
      ))}
      <Space size={4}>
        {first?.resolvable && (
          <Button
            size="small"
            type="link"
            onClick={() =>
              run(
                () => put(`${basePath}/discussions/${discussion.id}`, { resolved: !first.resolved }),
                first.resolved ? '已重新打开' : '已解决',
                [['discussions', basePath]]
              ).then(onDone)
            }
          >
            {first.resolved ? '重新打开' : '解决'}
          </Button>
        )}
        <Button size="small" type="link" onClick={() => setOpen(!open)}>
          回复
        </Button>
      </Space>
      {open && (
        <Space direction="vertical" style={{ width: '100%', marginTop: 4 }}>
          <Input.TextArea rows={2} value={reply} onChange={(e) => setReply(e.target.value)} />
          <Button
            size="small"
            type="primary"
            disabled={!reply.trim()}
            onClick={async () => {
              const ok = await run(
                () => post(`${basePath}/discussions/${discussion.id}/notes`, { body: reply }),
                '已回复',
                [['discussions', basePath], ['notes', basePath]]
              )
              if (ok) {
                setReply('')
                setOpen(false)
                onDone()
              }
            }}
          >
            发送
          </Button>
        </Space>
      )}
    </div>
  )
}

function DiffView({
  file,
  diffRefs,
  basePath,
  discussions,
  onRefresh
}: {
  file: Diff
  diffRefs?: DiffRefs
  basePath?: string
  discussions: Discussion[]
  onRefresh: () => void
}) {
  const lines = useMemo(() => parseDiffLines(file.diff), [file.diff])
  const run = useAction()
  const [draft, setDraft] = useState<{ oldLine: number | null; newLine: number | null } | null>(null)
  const [body, setBody] = useState('')
  const path = file.new_path || file.old_path
  const canComment = Boolean(diffRefs && basePath)

  const submit = async () => {
    if (!draft || !diffRefs || !basePath || !body.trim()) return
    const position = {
      base_sha: diffRefs.base_sha,
      start_sha: diffRefs.start_sha,
      head_sha: diffRefs.head_sha,
      position_type: 'text' as const,
      old_path: file.old_path,
      new_path: file.new_path,
      old_line: draft.oldLine,
      new_line: draft.newLine
    }
    const ok = await run(
      () => post(`${basePath}/discussions`, { body, position }),
      '行内评论已发布',
      [['discussions', basePath], ['notes', basePath]]
    )
    if (ok) {
      setBody('')
      setDraft(null)
      onRefresh()
    }
  }

  return (
    <pre className="diff-view">
      {lines.map((line, i) => {
        if (line.type === 'hunk' || line.type === 'meta') {
          return (
            <div key={i} className={line.type === 'hunk' ? 'diff-hunk' : undefined}>
              {line.text || ' '}
            </div>
          )
        }
        const cls = line.type === 'add' ? 'diff-add' : line.type === 'del' ? 'diff-del' : undefined
        const threads = discussions.filter((d) => matchDiscussion(d, path, line.oldLine, line.newLine))
        const key = lineKey(path, line.oldLine, line.newLine)
        const drafting = draft && lineKey(path, draft.oldLine, draft.newLine) === key
        return (
          <div key={i}>
            <div className={`diff-line ${cls ?? ''}`}>
              <span className="diff-gutter">
                {line.oldLine ?? ''}
              </span>
              <span className="diff-gutter">
                {line.newLine ?? ''}
              </span>
              <span className="diff-code">{line.text || ' '}</span>
              {canComment && (line.type === 'add' || line.type === 'del' || line.type === 'ctx') && (
                <button
                  type="button"
                  className="diff-comment-btn"
                  title="添加行内评论"
                  onClick={() => {
                    setDraft({ oldLine: line.oldLine, newLine: line.newLine })
                    setBody('')
                  }}
                >
                  ＋
                </button>
              )}
            </div>
            {threads.map((d) => (
              <Thread key={d.id} discussion={d} basePath={basePath!} onDone={onRefresh} />
            ))}
            {drafting && (
              <div className="diff-thread">
                <Input.TextArea
                  rows={3}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="行内评论，支持 Markdown"
                  autoFocus
                />
                <Space style={{ marginTop: 8 }}>
                  <Button type="primary" size="small" disabled={!body.trim()} onClick={() => void submit()}>
                    评论
                  </Button>
                  <Button size="small" onClick={() => setDraft(null)}>
                    取消
                  </Button>
                </Space>
              </div>
            )}
          </div>
        )
      })}
    </pre>
  )
}

export default function DiffList({
  diffs,
  basePath,
  diffRefs,
  discussions = []
}: {
  diffs: Diff[]
  basePath?: string
  diffRefs?: DiffRefs
  discussions?: Discussion[]
}) {
  const qc = useQueryClient()
  if (diffs.length === 0) return <Empty description="没有文件变更" />
  const refresh = () => {
    if (basePath) void qc.invalidateQueries({ queryKey: ['discussions', basePath] })
  }
  return (
    <Collapse
      items={diffs.map((d, i) => {
        const [add, del] = countLines(d.diff)
        return {
          key: i,
          label: (
            <Space>
              {d.new_file && <Tag color="green">新增</Tag>}
              {d.deleted_file && <Tag color="red">删除</Tag>}
              {d.renamed_file && <Tag color="blue">重命名</Tag>}
              <span>{d.renamed_file ? `${d.old_path} → ${d.new_path}` : d.new_path}</span>
              <span style={{ color: '#52c41a' }}>+{add}</span>
              <span style={{ color: '#ff4d4f' }}>-{del}</span>
            </Space>
          ),
          children: d.diff ? (
            <DiffView file={d} diffRefs={diffRefs} basePath={basePath} discussions={discussions} onRefresh={refresh} />
          ) : (
            <Empty description="二进制文件或变更过大" />
          )
        }
      })}
    />
  )
}
