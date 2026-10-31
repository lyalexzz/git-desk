import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Select } from 'antd'
import { useQuery } from '@tanstack/react-query'
import { get } from '../api'
import type { Project } from '../types'

interface Props {
  value?: number
  onChange?: (value?: number) => void
  placeholder?: string
  style?: CSSProperties
  allowClear?: boolean
}

export default function ProjectSelect({ value, onChange, placeholder = '搜索并选择项目', style, allowClear }: Props) {
  const [input, setInput] = useState('')
  const [search, setSearch] = useState('')

  useEffect(() => {
    const t = setTimeout(() => setSearch(input), 300)
    return () => clearTimeout(t)
  }, [input])

  const list = useQuery({
    queryKey: ['project-options', search],
    queryFn: ({ signal }) =>
      get<Project[]>('/projects', {
        membership: true,
        simple: true,
        search,
        per_page: 30,
        order_by: 'last_activity_at'
      }, signal)
  })

  const current = useQuery({
    queryKey: ['project', value],
    queryFn: ({ signal }) => get<Project>(`/projects/${value}`, undefined, signal),
    enabled: value != null && !list.data?.some((p) => p.id === value)
  })

  const options = useMemo(() => {
    const items = [...(list.data ?? [])]
    if (current.data && !items.some((p) => p.id === current.data.id)) items.unshift(current.data)
    return items.map((p) => ({ value: p.id, label: p.name_with_namespace }))
  }, [list.data, current.data])

  return (
    <Select
      showSearch
      allowClear={allowClear}
      value={value}
      placeholder={placeholder}
      style={{ minWidth: 320, ...style }}
      filterOption={false}
      onSearch={setInput}
      onChange={(v) => onChange?.(v)}
      loading={list.isFetching}
      options={options}
      notFoundContent={list.isFetching ? '加载中…' : '没有匹配的项目'}
    />
  )
}
