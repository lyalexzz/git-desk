import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Select,
  Space,
  Switch,
  Typography
} from 'antd'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { DEFAULT_AI_MAX_CHARS, DEFAULT_REVIEW_PROMPT, type AiConnection, type AiPatch } from '../../../shared/ai'

interface Preset {
  value: string
  label: string
  baseUrl: string
  models: string[]
  hint?: string
}

const presets: Preset[] = [
  { value: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', models: ['deepseek-chat', 'deepseek-reasoner'] },
  {
    value: 'qwen',
    label: '通义千问（阿里云百炼）',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-plus', 'qwen-max', 'qwen-turbo']
  },
  {
    value: 'glm',
    label: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4-plus', 'glm-4-air', 'glm-4-flash'],
    hint: '智谱可能不支持拉取模型列表，可直接手动填写模型名称'
  },
  { value: 'kimi', label: 'Moonshot / Kimi', baseUrl: 'https://api.moonshot.cn/v1', models: ['moonshot-v1-32k', 'moonshot-v1-128k'] },
  {
    value: 'doubao',
    label: '豆包（火山方舟）',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    models: [],
    hint: '模型填写方舟控制台中的模型 ID 或推理接入点 ID（ep-xxxx）'
  },
  { value: 'siliconflow', label: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', models: [] },
  { value: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', models: ['gpt-4o-mini', 'gpt-4o'] },
  {
    value: 'ollama',
    label: 'Ollama 本地',
    baseUrl: 'http://localhost:11434/v1',
    models: [],
    hint: 'Ollama 不需要 API Key；请先在本机 ollama pull 好模型'
  },
  { value: 'custom', label: '自定义（OpenAI 兼容接口）', baseUrl: '', models: [] }
]

function presetOf(baseUrl: string): string {
  const url = baseUrl.replace(/\/+$/, '')
  return presets.find((p) => p.baseUrl && (url === p.baseUrl || url === p.baseUrl + '/v1'))?.value ?? 'custom'
}

type FormValues = Required<Omit<AiPatch, 'clearApiKey'>>

/** 可搜索的模型下拉框；输入列表里没有的名称时提供“使用自定义模型”选项 */
function ModelSelect({
  value,
  onChange,
  models,
  open,
  onOpenChange
}: {
  value?: string
  onChange?: (v: string) => void
  models: string[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [search, setSearch] = useState('')
  const options = useMemo(() => {
    const list = value && !models.includes(value) ? [value, ...models] : models
    const opts = list.map((m) => ({ value: m, label: m }))
    const s = search.trim()
    if (s && !list.includes(s)) opts.unshift({ value: s, label: `使用自定义模型：${s}` })
    return opts
  }, [models, value, search])

  return (
    <Select
      showSearch
      value={value || undefined}
      onChange={(v) => {
        onChange?.(v)
        setSearch('')
      }}
      onSearch={setSearch}
      searchValue={search}
      open={open}
      onDropdownVisibleChange={(o) => {
        onOpenChange(o)
        if (!o) setSearch('')
      }}
      options={options}
      filterOption={(input, o) => String(o?.value ?? '').toLowerCase().includes(input.trim().toLowerCase())}
      placeholder="先点击「拉取模型」，也可以直接输入模型名称"
      notFoundContent="没有模型，可直接输入名称"
      style={{ flex: 1, minWidth: 0 }}
    />
  )
}

export default function AiSettings() {
  const { message } = AntApp.useApp()
  const qc = useQueryClient()
  const [form] = Form.useForm<FormValues>()
  const cfg = useQuery({ queryKey: ['config'], queryFn: () => window.desktop.getConfig() })
  const ai = cfg.data?.ai
  const [preset, setPreset] = useState('custom')
  const [models, setModels] = useState<string[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    if (!ai) return
    form.setFieldsValue({
      baseUrl: ai.baseUrl,
      apiKey: '',
      model: ai.model,
      temperature: ai.temperature,
      maxChars: ai.maxChars,
      systemPrompt: ai.systemPrompt,
      ignoreTls: ai.ignoreTls
    })
    setPreset(presetOf(ai.baseUrl))
  }, [ai, form])

  const current = presets.find((p) => p.value === preset)
  const [modelOpen, setModelOpen] = useState(false)
  const modelList = useMemo(() => [...new Set([...models, ...(current?.models ?? [])])], [models, current])

  const connection = (): AiConnection => {
    const v = form.getFieldsValue()
    return { baseUrl: v.baseUrl ?? '', apiKey: v.apiKey, ignoreTls: Boolean(v.ignoreTls), model: v.model, temperature: v.temperature }
  }

  const choosePreset = (value: string) => {
    setPreset(value)
    setModels([])
    setTestResult(null)
    const p = presets.find((x) => x.value === value)
    if (p?.baseUrl) form.setFieldsValue({ baseUrl: p.baseUrl, model: p.models[0] ?? '' })
  }

  const fetchModels = async () => {
    setLoadingModels(true)
    try {
      const r = await window.desktop.aiListModels(connection())
      if (!r.ok) {
        message.error(r.error)
        return
      }
      setModels(r.data.models)
      if (r.data.baseUrl !== form.getFieldValue('baseUrl')?.trim().replace(/\/+$/, '')) {
        form.setFieldValue('baseUrl', r.data.baseUrl)
        message.info(`API 地址已自动补全为 ${r.data.baseUrl}`)
      }
      if (r.data.models.length === 0) message.warning('服务商没有返回任何模型，请手动填写模型名称')
      else {
        message.success(`已拉取 ${r.data.models.length} 个模型`)
        setModelOpen(true)
      }
    } finally {
      setLoadingModels(false)
    }
  }

  const test = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const r = await window.desktop.aiTest(connection())
      setTestResult(r.ok ? { ok: true, text: r.data } : { ok: false, text: r.error })
    } finally {
      setTesting(false)
    }
  }

  const save = async (v: FormValues) => {
    await window.desktop.saveConfig({ ai: { ...v, apiKey: v.apiKey || undefined } })
    form.setFieldValue('apiKey', '')
    message.success('AI 设置已保存')
    await qc.invalidateQueries({ queryKey: ['config'] })
  }

  const clearKey = async () => {
    await window.desktop.saveConfig({ ai: { clearApiKey: true } })
    message.success('已清除保存的 API Key')
    await qc.invalidateQueries({ queryKey: ['config'] })
  }

  return (
    <Card title="AI 助手" extra={<Typography.Text type="secondary">用于合并请求的 AI 代码审核</Typography.Text>}>
      <Form form={form} layout="vertical" onFinish={save} initialValues={{ maxChars: DEFAULT_AI_MAX_CHARS }}>
        <Form.Item label="服务商" extra={current?.hint}>
          <Select value={preset} onChange={choosePreset} options={presets.map((p) => ({ value: p.value, label: p.label }))} />
        </Form.Item>
        <Form.Item
          label="API 地址（OpenAI 兼容接口）"
          name="baseUrl"
          rules={[{ required: true, message: '请填写 API 地址' }]}
          extra="填写到 /v1 一级即可，例如 https://api.deepseek.com 或 http://localhost:11434/v1"
        >
          <Input placeholder="https://api.example.com/v1" onChange={(e) => setPreset(presetOf(e.target.value))} />
        </Form.Item>
        <Form.Item label="API Key" name="apiKey" extra="加密保存在本机，只在主进程中使用">
          <Input.Password
            autoComplete="off"
            placeholder={ai?.hasApiKey ? '已保存，留空不修改' : 'sk-...（本地模型可留空）'}
          />
        </Form.Item>
        {ai?.hasApiKey && (
          <Popconfirm title="确定清除已保存的 API Key？" onConfirm={clearKey}>
            <Button type="link" size="small" style={{ padding: 0, marginTop: -16, marginBottom: 8 }}>
              清除已保存的 Key
            </Button>
          </Popconfirm>
        )}
        <Form.Item label="模型" required extra={models.length ? `已拉取 ${models.length} 个模型，可输入关键字搜索` : undefined}>
          <Space.Compact style={{ width: '100%' }}>
            <Form.Item name="model" noStyle rules={[{ required: true, message: '请选择或填写模型' }]}>
              <ModelSelect models={modelList} open={modelOpen} onOpenChange={setModelOpen} />
            </Form.Item>
            <Button loading={loadingModels} onClick={fetchModels}>
              拉取模型
            </Button>
          </Space.Compact>
        </Form.Item>
        <Space size={24} wrap>
          <Form.Item label="温度（留空使用模型默认值）" name="temperature">
            <InputNumber min={0} max={2} step={0.1} placeholder="默认" style={{ width: 160 }} />
          </Form.Item>
          <Form.Item label="审核内容上限（字符）" name="maxChars" tooltip="单次审核发送给模型的代码变更最多字符数，超出的文件会被跳过">
            <InputNumber min={5000} max={1000000} step={10000} style={{ width: 180 }} />
          </Form.Item>
          <Form.Item label="忽略 HTTPS 证书校验（内网网关）" name="ignoreTls" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Space>
        <Form.Item
          label={
            <Space>
              审核提示词（系统提示词）
              <Button size="small" type="link" onClick={() => form.setFieldValue('systemPrompt', DEFAULT_REVIEW_PROMPT)}>
                恢复默认
              </Button>
            </Space>
          }
          name="systemPrompt"
        >
          <Input.TextArea autoSize={{ minRows: 6, maxRows: 16 }} />
        </Form.Item>
        {testResult && (
          <Alert
            type={testResult.ok ? 'success' : 'error'}
            showIcon
            message={testResult.text}
            style={{ marginBottom: 16 }}
          />
        )}
        <Space>
          <Button type="primary" htmlType="submit">
            保存
          </Button>
          <Button loading={testing} onClick={test}>
            测试
          </Button>
        </Space>
      </Form>
    </Card>
  )
}
