import { app, safeStorage } from 'electron'
import { join } from 'node:path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { AppConfig, SaveConfigInput } from '../shared/types'

interface StoredConfig {
  baseUrl: string
  tokenEnc?: string
  tokenPlain?: string
  ignoreTls: boolean
  pollMinutes: number
  notify: boolean
}

const defaults: StoredConfig = { baseUrl: '', ignoreTls: false, pollMinutes: 2, notify: true }

function configFile(): string {
  return join(app.getPath('userData'), 'config.json')
}

function read(): StoredConfig {
  try {
    if (existsSync(configFile())) {
      return { ...defaults, ...JSON.parse(readFileSync(configFile(), 'utf8')) }
    }
  } catch {
    // corrupted file: fall back to defaults
  }
  return { ...defaults }
}

function write(cfg: StoredConfig): void {
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(configFile(), JSON.stringify(cfg, null, 2), 'utf8')
}

export function getConfig(): AppConfig {
  const s = read()
  return {
    baseUrl: s.baseUrl,
    ignoreTls: s.ignoreTls,
    pollMinutes: s.pollMinutes,
    notify: s.notify,
    hasToken: Boolean(s.tokenEnc || s.tokenPlain)
  }
}

export function getToken(): string {
  const s = read()
  if (s.tokenEnc && safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(s.tokenEnc, 'base64'))
    } catch {
      return ''
    }
  }
  return s.tokenPlain ?? ''
}

export function saveConfig(input: SaveConfigInput): AppConfig {
  const s = read()
  s.baseUrl = input.baseUrl.trim().replace(/\/+$/, '')
  s.ignoreTls = input.ignoreTls
  s.pollMinutes = Math.max(1, Math.min(60, Math.round(input.pollMinutes || 2)))
  s.notify = input.notify
  const token = input.token?.trim()
  if (token) {
    if (safeStorage.isEncryptionAvailable()) {
      s.tokenEnc = safeStorage.encryptString(token).toString('base64')
      delete s.tokenPlain
    } else {
      s.tokenPlain = token
      delete s.tokenEnc
    }
  }
  write(s)
  return getConfig()
}

export function clearToken(): void {
  const s = read()
  delete s.tokenEnc
  delete s.tokenPlain
  write(s)
}
