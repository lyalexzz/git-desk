import { Collapse, Empty, Space, Tag } from 'antd'
import type { Diff } from '../types'

function DiffView({ diff }: { diff: string }) {
  return (
    <pre className="diff-view">
      {diff.split('\n').map((line, i) => {
        const cls = line.startsWith('@@')
          ? 'diff-hunk'
          : line.startsWith('+')
            ? 'diff-add'
            : line.startsWith('-')
              ? 'diff-del'
              : undefined
        return (
          <div key={i} className={cls}>
            {line || ' '}
          </div>
        )
      })}
    </pre>
  )
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

export default function DiffList({ diffs }: { diffs: Diff[] }) {
  if (diffs.length === 0) return <Empty description="没有文件变更" />
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
          children: d.diff ? <DiffView diff={d.diff} /> : <Empty description="二进制文件或变更过大" />
        }
      })}
    />
  )
}
