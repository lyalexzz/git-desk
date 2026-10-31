import { useMemo } from 'react'
import hljs from 'highlight.js/lib/common'
import 'highlight.js/styles/github.css'

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

function languageFor(fileName: string): string | undefined {
  const lower = fileName.toLowerCase()
  if (lower === 'makefile') return 'makefile'
  if (lower === 'dockerfile' || lower.endsWith('.dockerfile')) return 'bash'
  const lang = extLang[lower.split('.').pop() ?? '']
  return lang && hljs.getLanguage(lang) ? lang : undefined
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export default function CodeView({ code, fileName }: { code: string; fileName: string }) {
  const html = useMemo(() => {
    const lang = languageFor(fileName)
    if (!lang || code.length > 500_000) return escapeHtml(code)
    try {
      return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
    } catch {
      return escapeHtml(code)
    }
  }, [code, fileName])

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
