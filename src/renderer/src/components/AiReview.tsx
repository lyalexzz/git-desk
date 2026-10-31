import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, App as AntApp, Button, Collapse, Empty, Popconfirm, Result, Segmented, Space, Spin, Tag, Typography } from 'antd'
import { useQuery, type QueryKey } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { post, useAction } from '../api'
import { buildReviewInput, focusOptions, splitThink, type ReviewFocus } from '../aiPrompt'
import Markdown from './Markdown'
import type { AiUsage } from '../../../shared/ai'
import type { Diff, MergeRequest } from '../types'

type Status = 'idle' | 'running' | 'done' | 'stopped' | 'error'

interface Props {
  base: string
  mr: MergeRequest
  diffs?: Diff[]
  diffsLoading: boolean
  diffsError?: Error | null
  /** 发布评论后需要刷新的查询 */
  invalidate: QueryKey[]
}

export default function AiReview({ base, mr, diffs, diffsLoading, diffsError, invalidate }: Props) {
  const { message } = AntApp.useApp()
  const navigate = useNavigate()
  const run = useAction()
  const cfg = useQuery({ queryKey: ['config'], queryFn: () => window.desktop.getConfig() })
  const ai = cfg.data?.ai

  const [focus, setFocus] = useState<ReviewFocus>('all')
  const [status, setStatus] = useState<Status>('idle')
  const [content, setContent] = useState('')
  const [reasoning, setReasoning] = useState('')
  const [error, setError] = useState('')
  const [meta, setMeta] = useState<{ model: string; finishReason: string | null; usage?: AiUsage } | null>(null)
  const idRef = useRef('')
  const buf = useRef({ content: '', reasoning: '' })
  const timer = useRef<number>()

  const input = useMemo(
    () => (diffs && ai ? buildReviewInput(mr, diffs, ai.maxChars, focus) : null),
    [mr, diffs, ai, focus]
  )

  useEffect(() => {
    const flush = () => {
      window.clearTimeout(timer.current)
      timer.current = undefined
      setContent(buf.current.content)
      setReasoning(buf.current.reasoning)
    }
    const off = window.desktop.onAiStream((e) => {
      if (e.id !== idRef.current) return
      if (e.type === 'chunk') {
        buf.current.content += e.delta ?? ''
        buf.current.reasoning += e.reasoning ?? ''
        timer.current ??= window.setTimeout(flush, 80)
        return
      }
      flush()
      idRef.current = ''
      if (e.type === 'error') {
        setError(e.error)
        setStatus('error')
      } else if (e.finishReason === 'cancelled') {
        setStatus('stopped')
      } else {
        setMeta({ model: e.model, finishReason: e.finishReason, usage: e.usage })
        setStatus('done')
      }
    })
    return () => {
      off()
      window.clearTimeout(timer.current)
      if (idRef.current) void window.desktop.aiCancel(idRef.current)
    }
  }, [])

  const start = async () => {
    if (!ai || !input) return
    const id = crypto.randomUUID()
    idRef.current = id
    buf.current = { content: '', reasoning: '' }
    setContent('')
    setReasoning('')
    setError('')
    setMeta(null)
    setStatus('running')
    await window.desktop.aiChat({
      id,
      messages: [
        { role: 'system', content: ai.systemPrompt },
        { role: 'user', content: input.prompt }
      ]
    })
  }

  const stop = () => {
    if (idRef.current) void window.desktop.aiCancel(idRef.current)
  }

  const { think, answer } = splitThink(content)
  const thinking = [reasoning, think].filter(Boolean).join('\n')
  const model = meta?.model || ai?.model || ''

  const copy = async () => {
    await navigator.clipboard.writeText(answer)
    message.success('已复制到剪贴板')
  }

  const publish = () =>
    run(
      () => post(`${base}/notes`, { body: `**AI 代码审核**（模型：${model}，仅供参考）\n\n${answer}` }),
      '已发布到讨论区',
      invalidate
    )

  if (cfg.isLoading) return <Spin />
  if (!ai?.configured) {
    return (
      <Result
        status="info"
        title="尚未配置 AI 助手"
        subTitle="在设置中填写 AI 服务的接口地址、API Key 并选择模型后，即可使用 AI 审核合并请求的代码"
        extra={
          <Button type="primary" onClick={() => navigate('/settings')}>
            去设置
          </Button>
        }
      />
    )
  }
  if (diffsLoading) return <Spin tip="正在加载代码变更…"><div style={{ height: 80 }} /></Spin>
  if (diffsError) return <Empty description={diffsError.message} />
  if (!input) return null

  const running = status === 'running'
  const hasResult = answer.trim().length > 0

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={12}>
      <Space wrap>
        <span>审核重点：</span>
        <Segmented
          value={focus}
          onChange={(v) => setFocus(v as ReviewFocus)}
          options={focusOptions.map((f) => ({ value: f.value, label: f.label }))}
          disabled={running}
        />
        <Tag color="blue">模型：{ai.model}</Tag>
      </Space>

      <Typography.Text type="secondary">
        将发送 {input.files} 个文件的变更，约 {input.chars.toLocaleString()} 字符（上限 {ai.maxChars.toLocaleString()}）
        {diffs?.length === 100 && '；GitLab 只返回了前 100 个文件'}
      </Typography.Text>
      {(input.skipped.length > 0 || input.truncated.length > 0) && (
        <Alert
          type="warning"
          showIcon
          message={`${input.skipped.length} 个文件未发送，${input.truncated.length} 个文件被截断`}
          description={
            <div style={{ maxHeight: 160, overflow: 'auto' }}>
              {input.skipped.map((s) => (
                <div key={s.path}>
                  {s.path}：{s.reason}
                </div>
              ))}
              {input.truncated.map((p) => (
                <div key={p}>{p}：差异过长，已截断</div>
              ))}
            </div>
          }
        />
      )}

      <Space wrap>
        {running ? (
          <Button danger onClick={stop}>
            停止
          </Button>
        ) : (
          <Button type="primary" onClick={start} disabled={input.files === 0}>
            {status === 'idle' ? '开始审核' : '重新审核'}
          </Button>
        )}
        <Button onClick={copy} disabled={!hasResult || running}>
          复制
        </Button>
        <Popconfirm
          title="发布为评论？"
          description="审核结果会以你的身份发布到该合并请求的讨论区"
          onConfirm={publish}
          disabled={!hasResult || running}
        >
          <Button disabled={!hasResult || running}>发布为评论</Button>
        </Popconfirm>
      </Space>

      {error && <Alert type="error" showIcon message={error} />}
      {status === 'stopped' && <Alert type="info" showIcon message="已停止，下方为停止前生成的内容" />}
      {meta?.finishReason === 'length' && (
        <Alert type="warning" showIcon message="输出达到模型长度上限，审核结果可能不完整" />
      )}

      {thinking && (
        <Collapse
          size="small"
          items={[
            {
              key: 'think',
              label: running && !hasResult ? '正在思考…' : `思考过程（${thinking.length} 字）`,
              children: (
                <pre className="pre-text" style={{ maxHeight: 300, overflow: 'auto', color: '#8c8c8c' }}>
                  {thinking}
                </pre>
              )
            }
          ]}
        />
      )}
      {running && !hasResult && !thinking && <Spin tip="正在等待模型响应…"><div style={{ height: 60 }} /></Spin>}
      {hasResult && <Markdown source={answer} />}
      {status === 'done' && meta?.usage?.total_tokens != null && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          模型 {meta.model}，消耗 {meta.usage.total_tokens} tokens（输入 {meta.usage.prompt_tokens ?? '-'}，输出{' '}
          {meta.usage.completion_tokens ?? '-'}）
        </Typography.Text>
      )}
      {status === 'idle' && input.files === 0 && <Empty description="没有可审核的代码变更" />}
    </Space>
  )
}
