import { useMemo, type MouseEvent } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { openExternal } from '../api'

export default function Markdown({ source }: { source: string }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(source, { async: false }) as string), [source])

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const a = (e.target as HTMLElement).closest('a')
    if (!a) return
    e.preventDefault()
    const href = a.getAttribute('href') ?? ''
    if (/^https?:\/\//i.test(href)) openExternal(href)
  }

  return <div className="markdown-body" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
}
