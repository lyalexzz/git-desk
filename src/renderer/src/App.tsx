import { useEffect, useState } from 'react'
import { Alert, Badge, Layout, Menu, Space, Spin, Typography } from 'antd'
import {
  BranchesOutlined,
  CheckSquareOutlined,
  DashboardOutlined,
  ExclamationCircleOutlined,
  FolderOutlined,
  PullRequestOutlined,
  SettingOutlined,
  TeamOutlined
} from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { ApiError, useMe } from './api'
import DashboardPage from './pages/DashboardPage'
import TodosPage from './pages/TodosPage'
import ProjectsPage from './pages/ProjectsPage'
import ProjectDetailPage from './pages/ProjectDetailPage'
import MergeRequestsPage from './pages/MergeRequestsPage'
import IssuesPage from './pages/IssuesPage'
import PipelinesPage from './pages/PipelinesPage'
import UsersPage from './pages/UsersPage'
import SettingsPage from './pages/SettingsPage'
import LoginPage from './pages/LoginPage'
import { authMethodText } from './labels'
import type { AppConfig } from '../../shared/types'

const { Sider, Header, Content } = Layout

function MainLayout({ config }: { config: AppConfig }) {
  const navigate = useNavigate()
  const location = useLocation()
  const me = useMe()
  const [todoCount, setTodoCount] = useState(0)

  useEffect(() => window.desktop.onNavigate((p) => navigate(p)), [navigate])
  useEffect(() => window.desktop.onTodoCount(setTodoCount), [])

  const selected = '/' + (location.pathname.split('/')[1] ?? '')
  const authFailed = me.error instanceof ApiError && me.error.status === 401

  if (authFailed) return <LoginPage />

  const productName = config.isJihu ? '极狐 GitLab' : 'GitLab'

  return (
    <Layout style={{ height: '100vh' }}>
      <Sider theme="light" width={200} style={{ borderRight: '1px solid #f0f0f0' }}>
        <div className="app-logo">{productName} 桌面版</div>
        <Menu
          mode="inline"
          selectedKeys={[selected]}
          onClick={({ key }) => navigate(key)}
          style={{ borderInlineEnd: 'none' }}
          items={[
            { key: '/', icon: <DashboardOutlined />, label: '工作台' },
            {
              key: '/todos',
              icon: <CheckSquareOutlined />,
              label: (
                <Space>
                  待办
                  <Badge count={todoCount} size="small" />
                </Space>
              )
            },
            { key: '/projects', icon: <FolderOutlined />, label: '项目' },
            { key: '/mrs', icon: <PullRequestOutlined />, label: '合并请求' },
            { key: '/issues', icon: <ExclamationCircleOutlined />, label: 'Issue' },
            { key: '/pipelines', icon: <BranchesOutlined />, label: '流水线' },
            { key: '/users', icon: <TeamOutlined />, label: '用户与权限' },
            { key: '/settings', icon: <SettingOutlined />, label: '设置' }
          ]}
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
            {config.serverVersion && ` · ${productName} ${config.serverVersion}`}
          </Typography.Text>
          <span>
            {me.data ? `${me.data.name}（${me.data.username}）${me.data.is_admin ? ' · 管理员' : ''}` : ''}
            {config.authMethod && (
              <Typography.Text type="secondary"> · {authMethodText[config.authMethod]}</Typography.Text>
            )}
          </span>
        </Header>
        <Content className="no-scrollbar" style={{ padding: 16, background: '#f5f5f5' }}>
          {me.error && !authFailed && (
            <Alert type="error" showIcon style={{ marginBottom: 16 }} message={`无法连接 GitLab：${(me.error as Error).message}`} />
          )}
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/todos" element={<TodosPage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/projects/:id" element={<ProjectDetailPage />} />
            <Route path="/mrs" element={<MergeRequestsPage />} />
            <Route path="/issues" element={<IssuesPage />} />
            <Route path="/pipelines" element={<PipelinesPage />} />
            <Route path="/users" element={<UsersPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </Content>
      </Layout>
    </Layout>
  )
}

export default function App() {
  const cfg = useQuery({ queryKey: ['config'], queryFn: () => window.desktop.getConfig() })

  if (cfg.isLoading) return <Spin style={{ marginTop: 200, width: '100%' }} />
  if (!cfg.data?.baseUrl || !cfg.data.loggedIn) return <LoginPage />
  return <MainLayout config={cfg.data} />
}
