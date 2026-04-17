import { useEffect, useState } from 'react'
import { Eye, EyeOff, GitBranch, Plus, Trash2, FileUp } from 'lucide-react'
import type { Theme, Language } from '../../types'
import MonacoWrapper from '../shared/MonacoWrapper'
import { useTranslation } from '../../lib/i18n'
import { FONT_PRESETS } from '../../stores/ui.store'

// ════════════════════════════════════════════════════════════════
// Shared types & styles
// ════════════════════════════════════════════════════════════════

export interface ProjectAuth {
  type: 'none' | 'inherit' | 'basic' | 'bearer' | 'api-key'
  bearerToken?: string
  basicUser?: string
  basicPass?: string
  apiKeyKey?: string
  apiKeyValue?: string
  apiKeyIn?: 'header' | 'query'
}

export interface ProjectProxy {
  mode: 'system' | 'none' | 'custom'
  host?: string
  port?: number
  bypass?: string
  proxyType?: 'http' | 'https' | 'socks'
  auth?: { username: string; password: string }
}

export interface ProjectSettings {
  auth: ProjectAuth
  preScript: string
  testScript: string
  // General
  requestTimeout: number
  maxResponseSizeMb: number
  trimRequest: boolean
  autoSave: boolean
  alwaysOpenNewTab: boolean
  askOnClose: boolean
  sendNoCache: boolean
  sendPostmanToken: boolean
  retainHeaders: boolean
  sslVerification: boolean
  followRedirects: boolean
  workingDirectory: string
  // Proxy
  proxy: ProjectProxy
  // Update
  autoCheckUpdates: boolean
  autoDownloadUpdates: boolean
}

export const BASE_INP: React.CSSProperties = {
  width: '100%',
  background: 'var(--input-bg)',
  border: '1.5px solid var(--border2)',
  borderRadius: 7,
  padding: '8px 10px',
  color: 'var(--text)',
  outline: 'none',
  boxSizing: 'border-box',
}

const COLORS = ['#2D5FA0', '#e85d4a', '#f5a623', '#1a7a4a', '#0066cc', '#7c4dff', '#e91e63', '#00897b', '#555555']
const EMOJIS = ['🚀', '⚡', '🔥', '🎯', '🌐', '🔌', '💻', '📡', '🛡️', '⚙️', '📦', '🗄️', '🔑', '💡', '🤖', '🌊']

export function PaneHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-5">
      <div className="text-[16px] font-semibold" style={{ color: 'var(--heading)' }}>{title}</div>
      {subtitle && (
        <div className="mt-0.5" style={{ color: 'var(--muted)' }}>
          {subtitle}
        </div>
      )}
    </div>
  )
}

export function Label({ text }: { text: string }) {
  return (
    <div
      style={{
        color: 'var(--muted)',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        marginBottom: 5,
      }}
    >
      {text}
    </div>
  )
}

function SectionCard({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div
      className="rounded-[8px] p-4"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      {title && (
        <div className="mb-3 font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
          {title}
        </div>
      )}
      {children}
    </div>
  )
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label
      className="flex cursor-pointer items-start gap-3 py-2"
      style={{ borderBottom: '1px dashed var(--border)' }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ marginTop: 3, accentColor: 'var(--accent)' }}
      />
      <div className="flex-1">
        <div style={{ color: 'var(--text)' }}>{label}</div>
        {hint && (
          <div className="mt-0.5" style={{ color: 'var(--muted)' }}>{hint}</div>
        )}
      </div>
    </label>
  )
}

function NumberInput({
  value,
  onChange,
  min,
  max,
  suffix,
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  suffix?: string
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ ...BASE_INP, width: 140 }}
      />
      {suffix && <span style={{ color: 'var(--muted)' }}>{suffix}</span>}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// Overview
// ════════════════════════════════════════════════════════════════

export function OverviewPane(props: {
  name: string
  desc: string
  iconMode: 'auto' | 'emoji'
  iconEmoji: string
  iconColor: string
  onNameChange: (v: string) => void
  onDescChange: (v: string) => void
  onIconModeChange: (v: 'auto' | 'emoji') => void
  onIconEmojiChange: (v: string) => void
  onIconColorChange: (v: string) => void
  typeLabel: string
  createdAt: number
  updatedAt: number
}) {
  const { t } = useTranslation()
  return (
    <div className="p-6">
      <PaneHeader title={t('overview.title')} subtitle={t('overview.subtitle')} />
      <div className="flex flex-col gap-4">
        <div>
          <Label text={t('overview.name')} />
          <input
            value={props.name}
            onChange={(e) => props.onNameChange(e.target.value)}
            style={BASE_INP}
          />
        </div>

        <div>
          <Label text={t('overview.description')} />
          <textarea
            value={props.desc}
            onChange={(e) => props.onDescChange(e.target.value)}
            rows={3}
            style={{ ...BASE_INP, resize: 'vertical', fontFamily: 'inherit' }}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label text={t('overview.icon')} />
            <div className="mb-2 flex gap-2">
              <button
                type="button"
                onClick={() => { props.onIconModeChange('auto'); props.onIconEmojiChange('') }}
                className="flex-1 cursor-pointer rounded-[7px] py-1.5"
                style={{
                  border: `1.5px solid ${props.iconMode === 'auto' ? 'var(--accent)' : 'var(--border2)'}`,
                  background: props.iconMode === 'auto' ? 'var(--accent-light)' : 'var(--white)',
                  color: props.iconMode === 'auto' ? 'var(--accent-text)' : 'var(--text)',
                  fontWeight: props.iconMode === 'auto' ? 600 : 400,
                }}
              >
                {t('overview.initials')}
              </button>
              <button
                type="button"
                onClick={() => props.onIconModeChange('emoji')}
                className="flex-1 cursor-pointer rounded-[7px] py-1.5"
                style={{
                  border: `1.5px solid ${props.iconMode === 'emoji' ? 'var(--accent)' : 'var(--border2)'}`,
                  background: props.iconMode === 'emoji' ? 'var(--accent-light)' : 'var(--white)',
                  color: props.iconMode === 'emoji' ? 'var(--accent-text)' : 'var(--text)',
                  fontWeight: props.iconMode === 'emoji' ? 600 : 400,
                }}
              >
                {t('overview.emoji')}
              </button>
            </div>
            {props.iconMode === 'emoji' && (
              <div className="flex flex-wrap gap-1">
                {EMOJIS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => props.onIconEmojiChange(e)}
                    className="cursor-pointer"
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 6,
                      border: `1.5px solid ${props.iconEmoji === e ? 'var(--accent)' : 'var(--border)'}`,
                      background: props.iconEmoji === e ? 'var(--accent-light)' : 'var(--white)',
                      fontSize: 16,
                    }}
                  >
                    {e}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <Label text={t('overview.accentColor')} />
            <div className="flex flex-wrap gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => props.onIconColorChange(c)}
                  className="cursor-pointer"
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 7,
                    background: c,
                    border: `2.5px solid ${c === props.iconColor ? 'var(--heading)' : 'transparent'}`,
                    transform: c === props.iconColor ? 'scale(1.12)' : 'scale(1)',
                    transition: 'all 0.15s',
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        <div
          className="mt-2 grid grid-cols-3 gap-4 rounded-[8px] p-3"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <MetaField label={t('overview.type')} value={props.typeLabel} />
          <MetaField label={t('overview.created')} value={new Date(props.createdAt).toLocaleDateString()} />
          <MetaField label={t('overview.updated')} value={new Date(props.updatedAt).toLocaleDateString()} />
        </div>
      </div>
    </div>
  )
}

function MetaField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="uppercase tracking-wide" style={{ color: 'var(--hint)' }}>{label}</div>
      <div className="mt-0.5" style={{ color: 'var(--text)' }}>{value}</div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// Authorization
// ════════════════════════════════════════════════════════════════

export function AuthPane({
  auth,
  onChange,
}: {
  auth: ProjectAuth
  onChange: (patch: Partial<ProjectAuth>) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="p-6">
      <PaneHeader title={t('authPane.title')} subtitle={t('authPane.subtitle')} />
      <div className="flex flex-col gap-4">
        <div>
          <Label text={t('authPane.type')} />
          <select
            value={auth.type}
            onChange={(e) => onChange({ type: e.target.value as ProjectAuth['type'] })}
            style={{ ...BASE_INP, cursor: 'pointer' }}
          >
            <option value="none">{t('auth.noAuth')}</option>
            <option value="inherit">{t('authPane.inherit')}</option>
            <option value="basic">{t('auth.basicAuth')}</option>
            <option value="bearer">{t('auth.bearerToken')}</option>
            <option value="api-key">{t('auth.apiKey')}</option>
          </select>
        </div>

        {auth.type === 'bearer' && (
          <div>
            <Label text={t('authPane.token')} />
            <input
              value={auth.bearerToken || ''}
              onChange={(e) => onChange({ bearerToken: e.target.value })}
              placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6…"
              style={{ ...BASE_INP, fontFamily: 'var(--font-mono)' }}
            />
          </div>
        )}

        {auth.type === 'basic' && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label text={t('authPane.username')} />
              <input
                value={auth.basicUser || ''}
                onChange={(e) => onChange({ basicUser: e.target.value })}
                style={BASE_INP}
              />
            </div>
            <div>
              <Label text={t('authPane.password')} />
              <input
                type="password"
                value={auth.basicPass || ''}
                onChange={(e) => onChange({ basicPass: e.target.value })}
                style={BASE_INP}
              />
            </div>
          </div>
        )}

        {auth.type === 'api-key' && (
          <div className="grid grid-cols-[1fr_1fr_140px] gap-3">
            <div>
              <Label text={t('authPane.key')} />
              <input
                value={auth.apiKeyKey || ''}
                onChange={(e) => onChange({ apiKeyKey: e.target.value })}
                style={BASE_INP}
              />
            </div>
            <div>
              <Label text={t('authPane.value')} />
              <input
                value={auth.apiKeyValue || ''}
                onChange={(e) => onChange({ apiKeyValue: e.target.value })}
                style={BASE_INP}
              />
            </div>
            <div>
              <Label text={t('authPane.addTo')} />
              <select
                value={auth.apiKeyIn || 'header'}
                onChange={(e) => onChange({ apiKeyIn: e.target.value as 'header' | 'query' })}
                style={{ ...BASE_INP, cursor: 'pointer' }}
              >
                <option value="header">{t('authPane.header')}</option>
                <option value="query">{t('authPane.queryParams')}</option>
              </select>
            </div>
          </div>
        )}

        {auth.type === 'none' && (
          <div
            className="rounded-[8px] p-4"
            style={{
              background: 'var(--surface)',
              border: '1px dashed var(--border2)',
              color: 'var(--muted)',
            }}
          >
            {t('authPane.noAuthHelp')}
          </div>
        )}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// Script pane (pre-request / tests)
// ════════════════════════════════════════════════════════════════

export function ScriptPane({
  title,
  description,
  value,
  onChange,
  language,
}: {
  title: string
  description: string
  value: string
  onChange: (v: string) => void
  language: string
}) {
  return (
    <div className="flex h-full flex-col p-6">
      <PaneHeader title={title} subtitle={description} />
      <div
        className="flex-1 overflow-hidden rounded-[8px]"
        style={{ border: '1px solid var(--border2)', minHeight: 320 }}
      >
        <MonacoWrapper
          value={value}
          onChange={onChange}
          language={language}
          lineNumbers="on"
          height="100%"
        />
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// Variables
// ════════════════════════════════════════════════════════════════

export function VariablesPane({
  envCount,
  globalVarsCount,
  onOpenManager,
}: {
  envCount: number
  globalVarsCount: number
  onOpenManager: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="p-6">
      <PaneHeader title={t('variablesPane.title')} subtitle={t('variablesPane.subtitle')} />

      <div className="grid grid-cols-2 gap-3">
        <StatCard label={t('variablesPane.environments')} value={envCount} />
        <StatCard label={t('variablesPane.globalVariables')} value={globalVarsCount} />
      </div>

      <button
        type="button"
        onClick={onOpenManager}
        className="mt-5 cursor-pointer rounded-[7px] px-4 py-2 font-semibold"
        style={{ background: 'var(--accent)', border: 'none', color: '#fff' }}
      >
        {t('variablesPane.openManager')}
      </button>

      <div
        className="mt-5 rounded-[8px] p-4"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--muted)' }}
      >
        {t('variablesPane.refHint')} <code style={{ color: 'var(--json-string)' }}>{'{{variableName}}'}</code>{' '}
        {t('variablesPane.refHintEnd')}
      </div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div
      className="rounded-[8px] p-4"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <div className="uppercase tracking-wide" style={{ color: 'var(--muted)' }}>{label}</div>
      <div className="mt-1 text-[24px] font-semibold" style={{ color: 'var(--heading)' }}>{value}</div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// Storage
// ════════════════════════════════════════════════════════════════

export function StoragePane(props: {
  projectId: string
  saveMode: 'local' | 'git' | 'both'
  localPath: string
  gitUrl: string
  gitUser: string
  gitBranch: string
  gitToken: string
  showToken: boolean
  modeLabels: Record<string, { label: string; icon: React.ReactNode }>
  onSaveModeChange: (v: 'local' | 'git' | 'both') => void
  onLocalPathChange: (v: string) => void
  onSelectDir: () => void
  onGitUrlChange: (v: string) => void
  onGitUserChange: (v: string) => void
  onGitBranchChange: (v: string) => void
  onGitTokenChange: (v: string) => void
  onToggleShowToken: () => void
}) {
  const { t } = useTranslation()
  async function handleExportProject() {
    try {
      const result = await window.api?.save?.exportProject?.(props.projectId)
      if (!result?.success && result?.error && result.error !== 'Cancelled') {
        console.error('Export project failed:', result.error)
      }
    } catch (err) {
      console.error(err)
    }
  }

  return (
    <div className="p-6">
      <PaneHeader title={t('storage.title')} subtitle={t('storage.subtitle')} />

      <div
        className="mb-4 flex items-center justify-between rounded-[8px] p-4"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
      >
        <div>
          <div style={{ fontWeight: 600, color: 'var(--text)' }}>{t('storage.exportProject')}</div>
          <div className="mt-0.5" style={{ color: 'var(--muted)' }}>
            {t('storage.exportDesc')}
          </div>
        </div>
        <button
          type="button"
          onClick={handleExportProject}
          className="cursor-pointer rounded-[7px] px-4 py-2"
          style={{ background: 'var(--accent)', color: '#fff', border: 'none', fontWeight: 600 }}
        >
          {t('storage.export')}
        </button>
      </div>

      <div className="flex flex-col gap-4">
        <div>
          <Label text={t('storage.saveMode')} />
          <div className="flex gap-2">
            {(['local', 'git', 'both'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => props.onSaveModeChange(m)}
                className="flex-1 cursor-pointer items-center gap-2 rounded-[8px] px-3 py-2"
                style={{
                  display: 'flex',
                  justifyContent: 'center',
                  border: `2px solid ${props.saveMode === m ? 'var(--accent)' : 'var(--border)'}`,
                  background: props.saveMode === m ? 'var(--accent-light)' : 'var(--white)',
                  color: props.saveMode === m ? 'var(--accent-text)' : 'var(--text)',
                  fontWeight: props.saveMode === m ? 600 : 400,
                }}
              >
                {props.modeLabels[m]?.icon}
                {props.modeLabels[m]?.label}
              </button>
            ))}
          </div>
        </div>

        {(props.saveMode === 'local' || props.saveMode === 'both') && (
          <div>
            <Label text={t('storage.localFolder')} />
            <div className="flex gap-2">
              <input
                value={props.localPath}
                readOnly
                placeholder={t('storage.selectFolder')}
                style={{ ...BASE_INP, fontFamily: 'var(--font-mono)', flex: 1 }}
              />
              <button
                type="button"
                onClick={props.onSelectDir}
                className="cursor-pointer rounded-[7px] px-3"
                style={{ background: 'var(--surface)', border: '1.5px solid var(--border2)', color: 'var(--text)' }}
              >
                {t('storage.browse')}
              </button>
            </div>
          </div>
        )}

        {(props.saveMode === 'git' || props.saveMode === 'both') && (
          <div
            className="flex flex-col gap-3 rounded-[8px] p-4"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            <div className="font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
              {t('storage.gitRepository')}
            </div>
            <div>
              <Label text={t('storage.url')} />
              <input
                value={props.gitUrl}
                onChange={(e) => props.onGitUrlChange(e.target.value)}
                placeholder="https://github.com/user/repo.git"
                style={{ ...BASE_INP, fontFamily: 'var(--font-mono)' }}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label text={t('storage.username')} />
                <input value={props.gitUser} onChange={(e) => props.onGitUserChange(e.target.value)} style={BASE_INP} />
              </div>
              <div>
                <Label text={t('storage.branch')} />
                <input
                  value={props.gitBranch}
                  onChange={(e) => props.onGitBranchChange(e.target.value)}
                  style={{ ...BASE_INP, fontFamily: 'var(--font-mono)' }}
                />
              </div>
            </div>
            <div>
              <Label text={t('storage.pat')} />
              <div className="flex gap-2">
                <input
                  type={props.showToken ? 'text' : 'password'}
                  value={props.gitToken}
                  onChange={(e) => props.onGitTokenChange(e.target.value)}
                  placeholder={t('storage.patPlaceholder')}
                  style={{ ...BASE_INP, fontFamily: 'var(--font-mono)', flex: 1 }}
                />
                <button
                  type="button"
                  onClick={props.onToggleShowToken}
                  className="cursor-pointer rounded-[7px] px-3"
                  style={{ background: 'var(--white)', border: '1.5px solid var(--border2)', color: 'var(--muted)' }}
                >
                  {props.showToken ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              </div>
              <div className="mt-1" style={{ color: 'var(--hint)' }}>
                {t('storage.tokenEnc')}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// Branches
// ════════════════════════════════════════════════════════════════

export function BranchesPane({
  branches,
  activeBranchId,
}: {
  branches: Array<{ name: string; current?: boolean; isRemote?: boolean }>
  activeBranchId: string | null
}) {
  const { t } = useTranslation()
  return (
    <div className="p-6">
      <PaneHeader title={t('branches.title')} subtitle={t('branches.subtitle')} />

      <div className="flex flex-col gap-1">
        {branches.length === 0 && (
          <div
            className="rounded-[8px] p-6 text-center"
            style={{ background: 'var(--surface)', border: '1px dashed var(--border2)', color: 'var(--hint)' }}
          >
            {t('branches.none')}
          </div>
        )}
        {branches.map((branch) => {
          const isActive = branch.current === true || branch.name === activeBranchId
          return (
            <div
              key={branch.name}
              className="flex items-center gap-2 rounded-[8px] px-4 py-2"
              style={{
                background: isActive ? 'var(--accent-light)' : 'var(--surface)',
                border: `1px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`,
                color: isActive ? 'var(--accent-text)' : 'var(--text)',
              }}
            >
              <GitBranch size={13} />
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: isActive ? 600 : 400 }}>{branch.name}</span>
              {branch.isRemote && (
                <span
                  className="rounded px-1.5 py-[1px] font-semibold"
                  style={{ background: 'var(--surface)', color: 'var(--muted)', border: '1px solid var(--border)' }}
                >
                  remote
                </span>
              )}
              {isActive && (
                <span
                  className="rounded px-1.5 py-[1px] font-semibold"
                  style={{ background: 'var(--green-bg)', color: 'var(--green)', border: '1px solid var(--green-border)' }}
                >
                  {t('branches.active')}
                </span>
              )}
              <span className="flex-1" />
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// General (Postman-style)
// ════════════════════════════════════════════════════════════════

export function GeneralPane({
  settings,
  onChange,
}: {
  settings: ProjectSettings
  onChange: (patch: Partial<ProjectSettings>) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="p-6">
      <PaneHeader title={t('general.title')} subtitle={t('general.subtitle')} />

      <div className="flex flex-col gap-4">
        <SectionCard title={t('general.requestBehavior')}>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label text={t('general.requestTimeout')} />
              <NumberInput
                value={settings.requestTimeout}
                onChange={(v) => onChange({ requestTimeout: v })}
                min={0}
                max={600000}
                suffix="ms"
              />
              <div className="mt-1" style={{ color: 'var(--hint)' }}>{t('general.requestTimeoutHint')}</div>
            </div>
            <div>
              <Label text={t('general.maxResponseSize')} />
              <NumberInput
                value={settings.maxResponseSizeMb}
                onChange={(v) => onChange({ maxResponseSizeMb: v })}
                min={1}
                max={4096}
                suffix="MB"
              />
              <div className="mt-1" style={{ color: 'var(--hint)' }}>{t('general.maxResponseHint')}</div>
            </div>
          </div>
          <div className="mt-3">
            <Toggle
              label={t('general.trim')}
              checked={settings.trimRequest}
              onChange={(v) => onChange({ trimRequest: v })}
            />
            <Toggle
              label={t('general.autoSave')}
              checked={settings.autoSave}
              onChange={(v) => onChange({ autoSave: v })}
            />
            <Toggle
              label={t('general.alwaysOpenNewTab')}
              checked={settings.alwaysOpenNewTab}
              onChange={(v) => onChange({ alwaysOpenNewTab: v })}
            />
            <Toggle
              label={t('general.askOnClose')}
              checked={settings.askOnClose}
              onChange={(v) => onChange({ askOnClose: v })}
            />
            <Toggle
              label={t('general.sslVerification')}
              checked={settings.sslVerification}
              onChange={(v) => onChange({ sslVerification: v })}
            />
            <Toggle
              label={t('general.followRedirects')}
              checked={settings.followRedirects}
              onChange={(v) => onChange({ followRedirects: v })}
            />
          </div>
        </SectionCard>

        <SectionCard title={t('general.headers')}>
          <Toggle
            label={t('general.sendNoCache')}
            checked={settings.sendNoCache}
            onChange={(v) => onChange({ sendNoCache: v })}
          />
          <Toggle
            label={t('general.sendPostmanToken')}
            checked={settings.sendPostmanToken}
            onChange={(v) => onChange({ sendPostmanToken: v })}
          />
          <Toggle
            label={t('general.retainHeaders')}
            checked={settings.retainHeaders}
            onChange={(v) => onChange({ retainHeaders: v })}
          />
        </SectionCard>

        <SectionCard title={t('general.editor')}>
          <div>
            <Label text={t('general.workingDirectory')} />
            <input
              value={settings.workingDirectory}
              onChange={(e) => onChange({ workingDirectory: e.target.value })}
              placeholder={t('general.workingDirectoryHint')}
              style={{ ...BASE_INP, fontFamily: 'var(--font-mono)' }}
            />
            <div className="mt-1" style={{ color: 'var(--hint)' }}>{t('general.workingDirectoryHint')}</div>
          </div>
        </SectionCard>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// Themes (central font family + size + locale + theme + accent)
// ════════════════════════════════════════════════════════════════

export function ThemesPane({
  theme,
  locale,
  fontSize,
  fontFamily,
  accentColor,
  onThemeChange,
  onLocaleChange,
  onFontSizeChange,
  onFontFamilyChange,
  onAccentColorChange,
}: {
  theme: Theme
  locale: Language
  fontSize: number
  fontFamily: string
  accentColor: string
  onThemeChange: (v: Theme) => void
  onLocaleChange: (v: Language) => void
  onFontSizeChange: (v: number) => void
  onFontFamilyChange: (v: string) => void
  onAccentColorChange: (v: string) => void
}) {
  const { t } = useTranslation()
  const themeOptions: Array<{ id: Theme; label: string }> = [
    { id: 'light', label: t('themes.light') },
    { id: 'dark', label: t('themes.dark') },
    { id: 'system', label: t('themes.system') },
  ]
  return (
    <div className="p-6">
      <PaneHeader title={t('themes.title')} subtitle={t('themes.subtitle')} />

      <div className="flex flex-col gap-5">
        <div>
          <Label text={t('settings.theme')} />
          <div className="flex gap-2">
            {themeOptions.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => onThemeChange(opt.id)}
                className="flex-1 cursor-pointer rounded-[8px] px-3 py-2"
                style={{
                  border: `2px solid ${theme === opt.id ? 'var(--accent)' : 'var(--border)'}`,
                  background: theme === opt.id ? 'var(--accent-light)' : 'var(--white)',
                  color: theme === opt.id ? 'var(--accent-text)' : 'var(--text)',
                  fontWeight: theme === opt.id ? 600 : 400,
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <Label text={t('themes.accentColor')} />
          <div className="flex flex-wrap gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => onAccentColorChange(c)}
                className="cursor-pointer"
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 7,
                  background: c,
                  border: `2.5px solid ${c === accentColor ? 'var(--heading)' : 'transparent'}`,
                  transform: c === accentColor ? 'scale(1.12)' : 'scale(1)',
                  transition: 'all 0.15s',
                }}
              />
            ))}
          </div>
        </div>

        <div>
          <Label text={t('settings.language')} />
          <select
            value={locale}
            onChange={(e) => onLocaleChange(e.target.value as Language)}
            style={{ ...BASE_INP, cursor: 'pointer' }}
          >
            <option value="en">English</option>
            <option value="tr">Türkçe</option>
          </select>
        </div>

        <div>
          <Label text={t('themes.fontFamily')} />
          <input
            type="text"
            value={fontFamily}
            onChange={(e) => onFontFamilyChange(e.target.value)}
            placeholder={t('themes.fontFamilyPlaceholder')}
            spellCheck={false}
            style={{ ...BASE_INP, fontFamily: fontFamily || undefined }}
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {FONT_PRESETS.map((p) => {
              const isActive = p.stack === fontFamily
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onFontFamilyChange(p.stack)}
                  className="cursor-pointer rounded-[6px] px-2 py-0.5"
                  style={{
                    border: `1px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`,
                    background: isActive ? 'var(--accent-light)' : 'var(--surface)',
                    color: isActive ? 'var(--accent-text)' : 'var(--text)',
                    fontFamily: p.stack,
                  }}
                >
                  {p.label}
                </button>
              )
            })}
          </div>
          <div className="mt-1" style={{ color: 'var(--hint)' }}>{t('themes.fontAppliesEverywhere')}</div>
        </div>

        <div>
          <Label text={t('themes.fontSize')} />
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={10}
              max={20}
              value={fontSize}
              onChange={(e) => onFontSizeChange(Number(e.target.value))}
              style={{ flex: 1, accentColor: 'var(--accent)' }}
            />
            <span
              className="rounded-[6px] px-2 py-0.5 font-semibold"
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                color: 'var(--text)',
                minWidth: 46,
                textAlign: 'center',
              }}
            >
              {fontSize}px
            </span>
          </div>
        </div>

        <div
          className="rounded-[8px] p-4"
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            fontFamily: fontFamily || undefined,
            fontSize: fontSize,
          }}
        >
          {t('themes.fontPreview')}
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// Shortcuts
// ════════════════════════════════════════════════════════════════

export function ShortcutsPane() {
  const { t } = useTranslation()
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform)
  const cmd = isMac ? '⌘' : 'Ctrl'
  const alt = isMac ? '⌥' : 'Alt'
  const rows: Array<{ action: string; keys: string }> = [
    { action: t('shortcuts.sendRequest'), keys: `${cmd} + Enter` },
    { action: t('shortcuts.saveRequest'), keys: `${cmd} + S` },
    { action: t('shortcuts.newTab'), keys: `${cmd} + T` },
    { action: t('shortcuts.closeTab'), keys: `${cmd} + W` },
    { action: t('shortcuts.nextTab'), keys: `${cmd} + ${alt} + →` },
    { action: t('shortcuts.prevTab'), keys: `${cmd} + ${alt} + ←` },
    { action: t('shortcuts.focusUrl'), keys: `${cmd} + L` },
    { action: t('shortcuts.toggleSidebar'), keys: `${cmd} + B` },
    { action: t('shortcuts.openSettings'), keys: `${cmd} + ,` },
    { action: t('shortcuts.search'), keys: `${cmd} + K` },
  ]
  return (
    <div className="p-6">
      <PaneHeader title={t('shortcuts.title')} subtitle={t('shortcuts.subtitle')} />
      <div
        className="overflow-hidden rounded-[8px]"
        style={{ border: '1px solid var(--border)' }}
      >
        <table className="w-full" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--surface)' }}>
              <th
                className="px-4 py-2 text-left uppercase tracking-wide"
                style={{ color: 'var(--muted)', borderBottom: '1px solid var(--border)', fontWeight: 600 }}
              >
                {t('shortcuts.action')}
              </th>
              <th
                className="px-4 py-2 text-right uppercase tracking-wide"
                style={{ color: 'var(--muted)', borderBottom: '1px solid var(--border)', fontWeight: 600 }}
              >
                {t('shortcuts.key')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.action} style={{ borderTop: '1px solid var(--border)' }}>
                <td className="px-4 py-2" style={{ color: 'var(--text)' }}>{r.action}</td>
                <td className="px-4 py-2 text-right">
                  <span
                    className="inline-block rounded-[6px] px-2 py-0.5"
                    style={{
                      fontFamily: 'var(--font-mono)',
                      background: 'var(--surface)',
                      border: '1px solid var(--border2)',
                      color: 'var(--text)',
                    }}
                  >
                    {r.keys}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// Data
// ════════════════════════════════════════════════════════════════

export function DataPane({
  projectId,
  onOpenImport,
}: {
  projectId: string
  onOpenImport: () => void
}) {
  const { t } = useTranslation()
  const [clearing, setClearing] = useState<'cache' | 'history' | null>(null)

  async function handleExport() {
    try {
      await window.api?.save?.exportProject?.(projectId)
    } catch (err) {
      console.error(err)
    }
  }

  async function handleClearHistory() {
    setClearing('history')
    try {
      await window.api?.history?.clear?.({ project_id: projectId })
    } catch (err) {
      console.error(err)
    }
    setClearing(null)
  }

  return (
    <div className="p-6">
      <PaneHeader title={t('data.title')} subtitle={t('data.subtitle')} />

      <div className="flex flex-col gap-3">
        <DataRow
          title={t('data.importData')}
          description={t('data.importDesc')}
          buttonLabel={t('data.importBtn')}
          onClick={onOpenImport}
        />
        <DataRow
          title={t('data.exportData')}
          description={t('data.exportDesc')}
          buttonLabel={t('data.exportBtn')}
          onClick={handleExport}
        />
        <DataRow
          title={t('data.clearHistory')}
          description={t('data.clearHistoryDesc')}
          buttonLabel={clearing === 'history' ? '…' : t('data.clearHistoryBtn')}
          destructive
          onClick={handleClearHistory}
        />
      </div>
    </div>
  )
}

function DataRow({
  title,
  description,
  buttonLabel,
  destructive,
  onClick,
}: {
  title: string
  description: string
  buttonLabel: string
  destructive?: boolean
  onClick: () => void
}) {
  return (
    <div
      className="flex items-center justify-between gap-4 rounded-[8px] p-4"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <div>
        <div style={{ fontWeight: 600, color: 'var(--text)' }}>{title}</div>
        <div className="mt-0.5" style={{ color: 'var(--muted)' }}>{description}</div>
      </div>
      <button
        type="button"
        onClick={onClick}
        className="cursor-pointer rounded-[7px] px-4 py-2"
        style={{
          background: destructive ? 'var(--red)' : 'var(--accent)',
          color: '#fff',
          border: 'none',
          fontWeight: 600,
          whiteSpace: 'nowrap',
        }}
      >
        {buttonLabel}
      </button>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// Certificates
// ════════════════════════════════════════════════════════════════

interface CertRow {
  id: string
  project_id: string
  kind: 'ca' | 'client'
  host: string | null
  crt_path: string | null
  key_path: string | null
  pfx_path: string | null
  passphrase: string | null
  enabled: number
  created_at: number
}

export function CertificatesPane({ projectId }: { projectId: string }) {
  const { t } = useTranslation()
  const [certs, setCerts] = useState<CertRow[]>([])
  const [loading, setLoading] = useState(false)

  async function reload() {
    setLoading(true)
    try {
      const res = await window.api?.certificate?.list(projectId) as { success: boolean; data?: CertRow[] } | undefined
      if (res?.success && res.data) setCerts(res.data)
    } catch (err) {
      console.error(err)
    }
    setLoading(false)
  }

  useEffect(() => { void reload() }, [projectId])

  async function handleAdd(kind: 'ca' | 'client') {
    try {
      const payload: {
        projectId: string
        kind: 'ca' | 'client'
        host?: string
        crtPath?: string
        keyPath?: string
        pfxPath?: string
        passphrase?: string
        enabled?: boolean
      } = { projectId, kind }
      if (kind === 'ca') {
        const pick = await window.api?.certificate?.pickFile('ca') as { success: boolean; data?: string }
        if (!pick?.success || !pick.data) return
        payload.crtPath = pick.data
      } else {
        // For simplicity add with a single cert file; user can edit via remove/re-add
        const pick = await window.api?.certificate?.pickFile('crt') as { success: boolean; data?: string }
        if (!pick?.success || !pick.data) return
        payload.crtPath = pick.data
        payload.host = ''
      }
      await window.api?.certificate?.add(payload)
      await reload()
    } catch (err) {
      console.error(err)
    }
  }

  async function handleDelete(id: string) {
    try {
      await window.api?.certificate?.delete(id)
      await reload()
    } catch (err) {
      console.error(err)
    }
  }

  async function handleToggle(c: CertRow, enabled: boolean) {
    try {
      await window.api?.certificate?.update({ id: c.id, enabled })
      await reload()
    } catch (err) {
      console.error(err)
    }
  }

  async function handleEditHost(c: CertRow, host: string) {
    try {
      await window.api?.certificate?.update({ id: c.id, host })
      await reload()
    } catch (err) {
      console.error(err)
    }
  }

  async function handlePickClientFile(c: CertRow, kind: 'crt' | 'key' | 'pfx') {
    try {
      const pick = await window.api?.certificate?.pickFile(kind) as { success: boolean; data?: string }
      if (!pick?.success || !pick.data) return
      const patch = kind === 'crt'
        ? { id: c.id, crtPath: pick.data }
        : kind === 'key'
        ? { id: c.id, keyPath: pick.data }
        : { id: c.id, pfxPath: pick.data }
      await window.api?.certificate?.update(patch)
      await reload()
    } catch (err) {
      console.error(err)
    }
  }

  async function handleEditPassphrase(c: CertRow, passphrase: string) {
    try {
      await window.api?.certificate?.update({ id: c.id, passphrase })
      await reload()
    } catch (err) {
      console.error(err)
    }
  }

  const caCerts = certs.filter((c) => c.kind === 'ca')
  const clientCerts = certs.filter((c) => c.kind === 'client')

  return (
    <div className="p-6">
      <PaneHeader title={t('certs.title')} subtitle={t('certs.subtitle')} />

      <div className="flex flex-col gap-5">
        <CertSection
          title={t('certs.ca')}
          description={t('certs.caDesc')}
          addLabel={t('certs.caAdd')}
          onAdd={() => handleAdd('ca')}
        >
          {caCerts.length === 0 && !loading && (
            <EmptyCerts text={t('certs.none')} />
          )}
          {caCerts.map((c) => (
            <div
              key={c.id}
              className="flex items-center gap-3 rounded-[8px] px-3 py-2"
              style={{ background: 'var(--white)', border: '1px solid var(--border)' }}
            >
              <input
                type="checkbox"
                checked={!!c.enabled}
                onChange={(e) => handleToggle(c, e.target.checked)}
                style={{ accentColor: 'var(--accent)' }}
              />
              <div className="flex-1 truncate" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
                {c.crt_path || '—'}
              </div>
              <button
                type="button"
                onClick={() => handleDelete(c.id)}
                className="cursor-pointer rounded-[6px] p-1.5"
                style={{ background: 'transparent', color: 'var(--red)', border: '1px solid var(--border)' }}
                title={t('certs.remove')}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </CertSection>

        <CertSection
          title={t('certs.client')}
          description={t('certs.clientDesc')}
          addLabel={t('certs.clientAdd')}
          onAdd={() => handleAdd('client')}
        >
          {clientCerts.length === 0 && !loading && (
            <EmptyCerts text={t('certs.none')} />
          )}
          {clientCerts.map((c) => (
            <div
              key={c.id}
              className="flex flex-col gap-2 rounded-[8px] p-3"
              style={{ background: 'var(--white)', border: '1px solid var(--border)' }}
            >
              <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2">
                <input
                  type="checkbox"
                  checked={!!c.enabled}
                  onChange={(e) => handleToggle(c, e.target.checked)}
                  style={{ accentColor: 'var(--accent)' }}
                />
                <input
                  value={c.host || ''}
                  onChange={(e) => handleEditHost(c, e.target.value)}
                  placeholder={t('certs.hostPlaceholder')}
                  style={{ ...BASE_INP, fontFamily: 'var(--font-mono)' }}
                />
                <button
                  type="button"
                  onClick={() => handleDelete(c.id)}
                  className="cursor-pointer rounded-[6px] p-1.5"
                  style={{ background: 'transparent', color: 'var(--red)', border: '1px solid var(--border)' }}
                  title={t('certs.remove')}
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <CertFileField
                  label={t('certs.crt')}
                  path={c.crt_path}
                  onPick={() => handlePickClientFile(c, 'crt')}
                />
                <CertFileField
                  label={t('certs.keyFile')}
                  path={c.key_path}
                  onPick={() => handlePickClientFile(c, 'key')}
                />
                <CertFileField
                  label={t('certs.pfx')}
                  path={c.pfx_path}
                  onPick={() => handlePickClientFile(c, 'pfx')}
                />
              </div>
              <div>
                <Label text={t('certs.passphrase')} />
                <input
                  type="password"
                  value={c.passphrase || ''}
                  onChange={(e) => handleEditPassphrase(c, e.target.value)}
                  style={BASE_INP}
                />
              </div>
            </div>
          ))}
        </CertSection>
      </div>
    </div>
  )
}

function CertSection({
  title,
  description,
  addLabel,
  onAdd,
  children,
}: {
  title: string
  description: string
  addLabel: string
  onAdd: () => void
  children: React.ReactNode
}) {
  return (
    <SectionCard>
      <div className="mb-3 flex items-center justify-between gap-4">
        <div>
          <div style={{ fontWeight: 600, color: 'var(--text)' }}>{title}</div>
          <div className="mt-0.5" style={{ color: 'var(--muted)' }}>{description}</div>
        </div>
        <button
          type="button"
          onClick={onAdd}
          className="cursor-pointer rounded-[7px] px-3 py-2"
          style={{ background: 'var(--accent)', color: '#fff', border: 'none', fontWeight: 600, whiteSpace: 'nowrap' }}
        >
          <span className="mr-1 inline-flex items-center"><Plus size={13} /></span>
          {addLabel}
        </button>
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </SectionCard>
  )
}

function CertFileField({
  label,
  path,
  onPick,
}: {
  label: string
  path: string | null
  onPick: () => void
}) {
  const { t } = useTranslation()
  return (
    <div>
      <Label text={label} />
      <button
        type="button"
        onClick={onPick}
        className="flex w-full cursor-pointer items-center gap-2 rounded-[7px] px-2 py-2 text-left"
        style={{ background: 'var(--surface)', border: '1px dashed var(--border2)', color: path ? 'var(--text)' : 'var(--hint)' }}
      >
        <FileUp size={13} />
        <span className="truncate" style={{ fontFamily: 'var(--font-mono)' }}>
          {path ? path : t('certs.selectFile')}
        </span>
      </button>
    </div>
  )
}

function EmptyCerts({ text }: { text: string }) {
  return (
    <div
      className="rounded-[8px] p-4 text-center"
      style={{ background: 'var(--white)', border: '1px dashed var(--border2)', color: 'var(--hint)' }}
    >
      {text}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// Proxy
// ════════════════════════════════════════════════════════════════

export function ProxyPane({
  settings,
  onChange,
}: {
  settings: ProjectSettings
  onChange: (patch: Partial<ProjectSettings>) => void
}) {
  const { t } = useTranslation()
  const proxy = settings.proxy
  function update(patch: Partial<ProjectProxy>) {
    onChange({ proxy: { ...proxy, ...patch } })
  }
  return (
    <div className="p-6">
      <PaneHeader title={t('proxy.title')} subtitle={t('proxy.subtitle')} />

      <div className="flex flex-col gap-4">
        <div>
          <Label text={t('proxy.mode')} />
          <div className="flex gap-2">
            {([
              { id: 'system', label: t('proxy.useSystem') },
              { id: 'none', label: t('proxy.noProxy') },
              { id: 'custom', label: t('proxy.custom') },
            ] as const).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => update({ mode: m.id })}
                className="flex-1 cursor-pointer rounded-[8px] px-3 py-2"
                style={{
                  border: `2px solid ${proxy.mode === m.id ? 'var(--accent)' : 'var(--border)'}`,
                  background: proxy.mode === m.id ? 'var(--accent-light)' : 'var(--white)',
                  color: proxy.mode === m.id ? 'var(--accent-text)' : 'var(--text)',
                  fontWeight: proxy.mode === m.id ? 600 : 400,
                }}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {proxy.mode === 'custom' && (
          <SectionCard>
            <div>
              <Label text={t('proxy.proxyType')} />
              <select
                value={proxy.proxyType || 'http'}
                onChange={(e) => update({ proxyType: e.target.value as ProjectProxy['proxyType'] })}
                style={{ ...BASE_INP, cursor: 'pointer' }}
              >
                <option value="http">HTTP</option>
                <option value="https">HTTPS</option>
                <option value="socks">SOCKS</option>
              </select>
            </div>
            <div className="mt-3 grid grid-cols-[1fr_120px] gap-3">
              <div>
                <Label text={t('proxy.host')} />
                <input
                  value={proxy.host || ''}
                  onChange={(e) => update({ host: e.target.value })}
                  placeholder="127.0.0.1"
                  style={{ ...BASE_INP, fontFamily: 'var(--font-mono)' }}
                />
              </div>
              <div>
                <Label text={t('proxy.port')} />
                <input
                  type="number"
                  value={proxy.port ?? 8080}
                  onChange={(e) => update({ port: Number(e.target.value) })}
                  style={{ ...BASE_INP, fontFamily: 'var(--font-mono)' }}
                />
              </div>
            </div>
            <div className="mt-3">
              <Label text={t('proxy.bypass')} />
              <input
                value={proxy.bypass || ''}
                onChange={(e) => update({ bypass: e.target.value })}
                placeholder={t('proxy.bypassPlaceholder')}
                style={{ ...BASE_INP, fontFamily: 'var(--font-mono)' }}
              />
            </div>
            <div className="mt-4 font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
              {t('proxy.auth')}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <div>
                <Label text={t('proxy.username')} />
                <input
                  value={proxy.auth?.username || ''}
                  onChange={(e) =>
                    update({ auth: { username: e.target.value, password: proxy.auth?.password || '' } })
                  }
                  style={BASE_INP}
                />
              </div>
              <div>
                <Label text={t('proxy.password')} />
                <input
                  type="password"
                  value={proxy.auth?.password || ''}
                  onChange={(e) =>
                    update({ auth: { username: proxy.auth?.username || '', password: e.target.value } })
                  }
                  style={BASE_INP}
                />
              </div>
            </div>
          </SectionCard>
        )}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// Update
// ════════════════════════════════════════════════════════════════

export function UpdatePane({
  settings,
  onChange,
  onCheckNow,
}: {
  settings: ProjectSettings
  onChange: (patch: Partial<ProjectSettings>) => void
  onCheckNow: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="p-6">
      <PaneHeader title={t('updateTab.title')} subtitle={t('updateTab.subtitle')} />
      <div className="flex flex-col gap-4">
        <SectionCard>
          <Toggle
            label={t('updateTab.autoCheck')}
            checked={settings.autoCheckUpdates}
            onChange={(v) => onChange({ autoCheckUpdates: v })}
          />
          <Toggle
            label={t('updateTab.autoInstall')}
            checked={settings.autoDownloadUpdates}
            onChange={(v) => onChange({ autoDownloadUpdates: v })}
          />
        </SectionCard>
        <button
          type="button"
          onClick={onCheckNow}
          className="self-start cursor-pointer rounded-[7px] px-4 py-2 font-semibold"
          style={{ background: 'var(--accent)', color: '#fff', border: 'none' }}
        >
          {t('updateTab.checkNow')}
        </button>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// About
// ════════════════════════════════════════════════════════════════

export function AboutPane() {
  const { t } = useTranslation()
  const [versions, setVersions] = useState<{ app?: string; electron?: string; node?: string; chrome?: string; platform?: string }>({})

  useEffect(() => {
    try {
      const w = window as unknown as { electron?: { process?: { versions?: Record<string, string>; platform?: string } } }
      const v = w.electron?.process?.versions
      setVersions({
        app: v?.app,
        electron: v?.electron,
        node: v?.node,
        chrome: v?.chrome,
        platform: w.electron?.process?.platform,
      })
    } catch { /* ignore */ }
  }, [])

  const rows: Array<{ label: string; value: string | undefined }> = [
    { label: t('about.version'), value: versions.app || '1.0.0' },
    { label: t('about.platform'), value: versions.platform },
    { label: t('about.electron'), value: versions.electron },
    { label: t('about.node'), value: versions.node },
    { label: t('about.chrome'), value: versions.chrome },
    { label: t('about.license'), value: 'MIT' },
  ]

  return (
    <div className="p-6">
      <PaneHeader title={t('about.title')} subtitle={t('about.subtitle')} />
      <div
        className="rounded-[8px] p-5"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
      >
        <div className="text-[18px] font-semibold" style={{ color: 'var(--heading)' }}>
          {t('about.appName')}
        </div>
        <div className="mt-1" style={{ color: 'var(--muted)' }}>{t('about.appTagline')}</div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          {rows.map((r) => (
            <div key={r.label}>
              <div className="uppercase tracking-wide" style={{ color: 'var(--hint)' }}>{r.label}</div>
              <div className="mt-0.5" style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>
                {r.value || '—'}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
