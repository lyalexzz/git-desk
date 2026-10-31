import { App as AntApp } from 'antd'
import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query'
import type { ApiRequest, QueryValue } from '../../shared/types'
import type { User } from './types'

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message)
  }
}

type Query = Record<string, QueryValue>

export async function request<T>(req: ApiRequest): Promise<{ data: T; total: number | null }> {
  const r = await window.desktop.request<T>(req)
  if (!r.ok) throw new ApiError(r.error, r.status)
  return { data: r.data, total: r.total }
}

export async function get<T>(path: string, query?: Query): Promise<T> {
  return (await request<T>({ path, query })).data
}

export async function getPage<T>(path: string, query?: Query): Promise<{ data: T[]; total: number | null }> {
  return request<T[]>({ path, query })
}

export async function getAll<T>(path: string, query: Query = {}, maxPages = 5): Promise<T[]> {
  const result: T[] = []
  for (let page = 1; page <= maxPages; page++) {
    const data = await get<T[]>(path, { ...query, per_page: 100, page })
    result.push(...data)
    if (data.length < 100) break
  }
  return result
}

export async function post<T = unknown>(path: string, body?: unknown): Promise<T> {
  return (await request<T>({ method: 'POST', path, body })).data
}

export async function put<T = unknown>(path: string, body?: unknown): Promise<T> {
  return (await request<T>({ method: 'PUT', path, body })).data
}

export async function del(path: string): Promise<void> {
  await request({ method: 'DELETE', path })
}

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: () => get<User>('/user'), staleTime: 5 * 60_000 })
}

/** 执行写操作：成功/失败提示 + 刷新相关查询 */
export function useAction() {
  const { message } = AntApp.useApp()
  const qc = useQueryClient()
  const refresh = (keys: QueryKey[]) =>
    Promise.all(keys.map((queryKey) => qc.invalidateQueries({ queryKey, refetchType: 'active' }, { cancelRefetch: true })))
  return async (fn: () => Promise<unknown>, success: string, invalidate: QueryKey[] = []): Promise<boolean> => {
    try {
      await fn()
    } catch (e) {
      message.error((e as Error).message)
      return false
    }
    message.success(success)
    await refresh(invalidate)
    // GitLab 部分写操作（重试流水线、合并、审批、待办等）在后台异步落库，稍后再拉一次
    if (invalidate.length) setTimeout(() => void refresh(invalidate), 1500)
    return true
  }
}

export function openExternal(url: string): void {
  void window.desktop.openExternal(url)
}
