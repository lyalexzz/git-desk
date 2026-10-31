import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Alert, App as AntApp, Badge, Button, Dropdown, Layout, Menu, Space, Spin, Tag, Typography } from 'antd'
import {
  BranchesOutlined,
  CheckSquareOutlined,
  DashboardOutlined,
  DesktopOutlined,
  ExclamationCircleOutlined,
  FileSearchOutlined,
  FolderOutlined,
  PlusOutlined,
  PullRequestOutlined,
  SettingOutlined,
  SwapOutlined,
  TeamOutlined,
  UserOutlined
} from '@ant-design/icons'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { ApiError, useMe } from './api'
import CommandPalette, { type PaletteOpenTarget } from './components/CommandPalette'
import IssueDrawer from './components/IssueDrawer'
import MrDrawer from './components/MrDrawer'
import LoginPage from './pages/LoginPage'
import { authMethodText, mrLabel, productName } from './labels'
import type { AppConfig } from '../../shared/types'

const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const TodosPage = lazy(() => import('./pages/TodosPage'))
const ProjectsPage = lazy(() => import('./pages/ProjectsPage'))
const ProjectDetailPage = lazy(() => import('./pages/ProjectDetailPage'))
const WorkspacePage = lazy(() => import('./pages/WorkspacePage'))
const MergeRequestsPage = lazy(() => import('./pages/MergeRequestsPage'))
const IssuesPage = lazy(() => import('./pages/IssuesPage'))
const PipelinesPage = lazy(() => import('./pages/PipelinesPage'))
const AuditPage = lazy(() => import('./pages/AuditPage'))
const UsersPage = lazy(() => import('./pages/UsersPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))

const { Sider, Header, Content } = Layout

function MainLayout({ config, onAddAccount }: { config: AppConfig; onAddAccount: () => void }) {
  const { message } = AntApp.useApp()
  const navigate = useNavigate()
  const location = useLocation()
  const qc = useQueryClient()
  const me = useMe()
  const [todoCount, setTodoCount] = useState(0)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [detail, setDetail] = useState<PaletteOpenTarget | null>(null)
  const caps = config.capabilities
  const provider = config.provider
  const mrText = mrLabel(provider)

  useEffect(() => window.desktop.onNavigate((p) => navigate(p)), [navigate])
  useEffect(() => window.desktop.onTodoCount(setTodoCount), [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const selected = '/' + (location.pathname.split('/')[1] ?? '')
  const authFailed = me.error instanceof ApiError && me.error.status === 401
  const shortcut = navigator.platform.toLowerCase().includes('mac') ? '⌘K' : 'Ctrl+K'

  if (authFailed) return <LoginPage />

  const product = productName(config.platform, config.isJihu)

  const menuItems = useMemo(() => {
    const items = [
      { key: '/', icon: <DashboardOutlined />, label: '工作台' },
      caps.todos
        ? {
            key: '/todos',
            icon: <CheckSquareOutlined />,
            label: (
              <Space>
                待办
                <Badge count={todoCount} size="small" />
              </Space>
            )
          }
        : null,
      { key: '/projects', icon: <FolderOutlined />, label: provider === 'github' ? '仓库' : '项目' },
      { key: '/workspace', icon: <DesktopOutlined />, label: '本地仓库' },
      { key: '/mrs', icon: <PullRequestOutlined />, label: mrText },
      { key: '/issues', icon: <ExclamationCircleOutlined />, label: 'Issue' },
      caps.pipelines ? { key: '/pipelines', icon: <BranchesOutlined />, label: '流水线' } : null,
      caps.audit ? { key: '/audit', icon: <FileSearchOutlined />, label: '审计日志' } : null,
      caps.adminUsers ? { key: '/users', icon: <TeamOutlined />, label: '用户与权限' } : null,
      { key: '/settings', icon: <SettingOutlined />, label: '设置' }
    ]
    return items.filter(Boolean) as { key: string; icon: React.ReactNode; label: React.ReactNode }[]
  }, [caps, todoCount, provider, mrText])

  // 能力关闭后若仍停在该路由，跳回首页
  useEffect(() => {
    const blocked: Record<string, boolean> = {
      '/todos': !caps.todos,
      '/pipelines': !caps.pipelines,
      '/audit': !caps.audit,
      '/users': !caps.adminUsers
    }
    if (blocked[selected]) navigate('/', { replace: true })
  }, [caps, selected, navigate])

  const switchTo = async (id: string) => {
    if (id === config.activeAccountId) return
    try {
      await window.desktop.switchAccount(id)
      qc.clear()
      await qc.invalidateQueries()
      message.success('已切换账号')
      navigate('/', { replace: true })
    } catch (e) {
      message.error((e as Error).message || '切换失败')
    }
  }

  const accountMenu = {
    items: [
      ...config.accounts
        .filter((a) => a.loggedIn)
        .map((a) => ({
          key: a.id,
          icon: <UserOutlined />,
          label: (
            <Space>
              <Tag color={a.provider === 'github' ? 'default' : 'blue'} style={{ marginInlineEnd: 0 }}>
                {a.provider === 'github' ? 'GitHub' : 'GitLab'}
              </Tag>
              <span>
                {a.label || a.username}
                {a.id === config.activeAccountId ? ' · 当前' : ''}
              </span>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {a.baseUrl.replace(/^https?:\/\//, '')}
              </Typography.Text>
            </Space>
          ),
          onClick: () => void switchTo(a.id)
        })),
      { type: 'divider' as const },
      {
        key: 'add',
        icon: <PlusOutlined />,
        label: '添加账号',
        onClick: onAddAccount
      }
    ]
  }

  return (
    <Layout style={{ height: '100vh' }}>
      <Sider theme="light" width={200} style={{ borderRight: '1px solid #f0f0f0' }}>
        <div className="app-logo">Git 桌面端</div>
        <Menu
          mode="inline"
          selectedKeys={[selected]}
          onClick={({ key }) => navigate(key)}
          style={{ borderInlineEnd: 'none' }}
          items={menuItems}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            background: '#fff',
            borderBottom: '1px solid #f0f0f0',
            padding: '0 24px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}
        >
          <Typography.Text type="secondary">
            {config.baseUrl}
            {config.serverVersion && ` · ${product} ${config.serverVersion}`}
          </Typography.Text>
          <Space>
            <Button type="text" size="small" onClick={() => setPaletteOpen(true)}>
              搜索 <Typography.Text type="secondary">{shortcut}</Typography.Text>
            </Button>
            <Dropdown menu={accountMenu} trigger={['click']}>
              <Button type="text" size="small" icon={<SwapOutlined />}>
                <Tag color={provider === 'github' ? 'default' : 'blue'} style={{ marginInlineEnd: 4 }}>
                  {provider === 'github' ? 'GitHub' : 'GitLab'}
                </Tag>
                {me.data ? `${me.data.name}` : config.accounts.find((a) => a.id === config.activeAccountId)?.label || '账号'}
                {config.authMethod && (
                  <Typography.Text type="secondary"> · {authMethodText[config.authMethod]}</Typography.Text>
                )}
              </Button>
            </Dropdown>
          </Space>
        </Header>
        <Content className="no-scrollbar" style={{ padding: 16, background: '#f5f5f5' }}>
          {me.error && !authFailed && (
            <Alert
              type="error"
              showIcon
              style={{ marginBottom: 16 }}
              message={`无法连接 ${product}：${(me.error as Error).message}`}
            />
          )}
          <Suspense fallback={<Spin style={{ marginTop: 80, width: '100%' }} />}>
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/todos" element={<TodosPage />} />
              <Route path="/projects" element={<ProjectsPage />} />
              <Route path="/projects/:id" element={<ProjectDetailPage />} />
              <Route path="/workspace" element={<WorkspacePage />} />
              <Route path="/mrs" element={<MergeRequestsPage />} />
              <Route path="/issues" element={<IssuesPage />} />
              <Route path="/pipelines" element={<PipelinesPage />} />
              <Route path="/audit" element={<AuditPage />} />
              <Route path="/users" element={<UsersPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" />} />
            </Routes>
          </Suspense>
        </Content>
      </Layout>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onOpen={setDetail} />
      <MrDrawer
        projectId={detail?.type === 'mr' ? detail.projectId : undefined}
        iid={detail?.type === 'mr' ? detail.iid : undefined}
        onClose={() => setDetail(null)}
      />
      <IssueDrawer
        projectId={detail?.type === 'issue' ? detail.projectId : undefined}
        iid={detail?.type === 'issue' ? detail.iid : undefined}
        onClose={() => setDetail(null)}
      />
    </Layout>
  )
}

export default function App() {
  const cfg = useQuery({ queryKey: ['config'], queryFn: () => window.desktop.getConfig() })
  const [addingAccount, setAddingAccount] = useState(false)

  if (cfg.isLoading) return <Spin style={{ marginTop: 200, width: '100%' }} />
  if (addingAccount) {
    return (
      <LoginPage
        onCancel={() => {
          setAddingAccount(false)
          void cfg.refetch()
        }}
      />
    )
  }
  if (!cfg.data?.baseUrl || !cfg.data.loggedIn) return <LoginPage />
  return <MainLayout config={cfg.data} onAddAccount={() => setAddingAccount(true)} />
}
