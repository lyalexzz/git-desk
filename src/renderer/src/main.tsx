import React from 'react'
import ReactDOM from 'react-dom/client'
import { App as AntApp, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import relativeTime from 'dayjs/plugin/relativeTime'
import { HashRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import './global.css'

dayjs.extend(relativeTime)
dayjs.locale('zh-cn')

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, error) => count < 1 && (error as Error).name !== 'AbortError',
      refetchOnWindowFocus: false,
      staleTime: 30_000
    }
  }
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{ token: { fontFamily: '"Microsoft YaHei", "PingFang SC", "Segoe UI", sans-serif' } }}
    >
      <AntApp>
        <QueryClientProvider client={queryClient}>
          <HashRouter>
            <App />
          </HashRouter>
        </QueryClientProvider>
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>
)
