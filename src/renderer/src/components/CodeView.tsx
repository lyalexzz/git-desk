import { useEffect, useMemo, useState } from 'react'

const extLang: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  vue: 'xml',
  html: 'xml',
  htm: 'xml',
  xml: 'xml',
  svg: 'xml',
  css: 'css',
  scss: 'scss',
  less: 'less',
  json: 'json',
  md: 'markdown',
  markdown: 'markdown',
  py: 'python',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  go: 'go',
  rs: 'rust',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  rb: 'ruby',
  sh: 'bash',
  bash: 'bash',
  sql: 'sql',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  conf: 'ini',
  properties: 'ini',
  swift: 'swift',
  lua: 'lua',
  pl: 'perl',
  r: 'r',
  graphql: 'graphql',
  gql: 'graphql',
  diff: 'diff',
  patch: 'diff',
  vb: 'vbnet',
  gradle: 'kotlin'
}

interface Highlighter {
  getLanguage(name: string): unknown
  highlight(code: string, options: { language: string; ignoreIllegals: boolean }): { value: string }
}

let highlighter: Promise<Highlighter> | null = null

function loadHighlighter(): Promise<Highlighter> {
  highlighter ??= Promise.all([
    import('highlight.js/lib/common'),
    // @ts-expect-error highlight.js 的 css 没有类型声明，打包时由 vite 处理
    import('highlight.js/styles/github.css')
  ]).then(([mod]) => mod.default)
  return highlighter
}

function languageFor(hljs: Highlighter, fileName: string): string | undefined {
  const lower = fileName.toLowerCase()
  if (lower === 'makefile') return hljs.getLanguage('makefile') ? 'makefile' : undefined
  if (lower === 'dockerfile' || lower.endsWith('.dockerfile')) return hljs.getLanguage('bash') ? 'bash' : undefined
  const lang = extLang[lower.split('.').pop() ?? '']
  return lang && hljs.getLanguage(lang) ? lang : undefined
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export default function CodeView({ code, fileName }: { code: string; fileName: string }) {
  const plain = useMemo(() => escapeHtml(code), [code])
  const [html, setHtml] = useState(plain)

  useEffect(() => {
    setHtml(plain)
    if (code.length > 500_000) return
    let cancelled = false
    void loadHighlighter()
      .then((hljs) => {
        if (cancelled) return
        const lang = languageFor(hljs, fileName)
        if (!lang) return
        try {
          setHtml(hljs.highlight(code, { language: lang, ignoreIllegals: true }).value)
        } catch {
          setHtml(plain)
        }
      })
      .catch(() => {
        if (!cancelled) setHtml(plain)
      })
    return () => {
      cancelled = true
    }
  }, [code, fileName, plain])

  const lineCount = code.endsWith('\n') ? code.split('\n').length - 1 : code.split('\n').length
  const gutter = useMemo(() => Array.from({ length: lineCount }, (_, i) => i + 1).join('\n'), [lineCount])

  return (
    <div className="code-view">
      <pre className="code-gutter">{gutter}</pre>
      <pre className="code-body">
        <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
    </div>
  )
}
