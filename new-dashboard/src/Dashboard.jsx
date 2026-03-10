import { useEffect, useMemo, useRef, useState } from 'react'
import { Bar, BarChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

const API_URL = 'http://localhost:8000/api/v1'
const SETTINGS_KEY = 'banjo-dashboard-settings-v1'

const DEFAULT_ALERT_THRESHOLDS = {
  ddPct: 20,
  concentrationPct: 35,
  leverageWeighted: 8,
  feeDragPct: 15
}

const DEFAULT_SHOW_SECTIONS = {
  health: true,
  execution: true,
  riskPerf: true,
  alerts: true,
  market: true,
  tables: true
}

const SECTION_PRESETS = {
  Core: { health: true, execution: false, riskPerf: true, alerts: true, market: true, tables: false },
  Ops: { health: true, execution: true, riskPerf: false, alerts: true, market: false, tables: true },
  Full: { health: true, execution: true, riskPerf: true, alerts: true, market: true, tables: true }
}

function Card({ label, value, color = '#b026ff' }) {
  return (
    <div style={{ background: '#1a1a2e', border: `1px solid ${color}`, padding: 'var(--card-pad, 20px)', borderRadius: 12, boxShadow: `0 0 16px ${color}33` }}>
      <p style={{ color: '#888', marginBottom: 8, fontSize: 'var(--card-label-size, 14px)' }}>{label}</p>
      <p style={{ fontSize: 'var(--card-value-size, 28px)', fontWeight: 'bold', color, margin: 0 }}>{value}</p>
    </div>
  )
}

function panelStyle() {
  return { marginTop: 22, background: '#10101a', border: '1px solid #2a2a3f', borderRadius: 12, padding: 16 }
}

function Badge({ ok, label }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '4px 10px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 700,
        background: ok ? '#14301b' : '#3a1212',
        color: ok ? '#39ff14' : '#ff6b6b',
        border: `1px solid ${ok ? '#39ff14' : '#ff6b6b'}`
      }}
    >
      {label}
    </span>
  )
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function exportCsv(filename, rows) {
  if (!rows?.length) return
  const headers = Object.keys(rows[0])
  const esc = (v) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
  }
  const body = rows.map((r) => headers.map((h) => esc(r[h])).join(',')).join('\n')
  const csv = `${headers.join(',')}\n${body}`
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function pickList(payload, keys = []) {
  if (Array.isArray(payload)) return payload
  if (!payload || typeof payload !== 'object') return []
  for (const k of keys) {
    if (Array.isArray(payload?.[k])) return payload[k]
  }
  if (Array.isArray(payload?.data)) return payload.data
  if (Array.isArray(payload?.items)) return payload.items
  return []
}

const fmtNum = (v, d = 2) => Number(v ?? 0).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })
const fmtUsd = (v, d = 2) => `$${fmtNum(v, d)}`
const fmtPct = (v, d = 2) => `${fmtNum(v, d)}%`
const fmtH = (v, d = 1) => `${fmtNum(v, d)}h`
const fmtLatency = (v) => {
  const n = Number(v ?? 0)
  if (!Number.isFinite(n)) return 'n/a'
  if (n >= 1000) return `${fmtNum(n / 1000, 2)}s`
  return `${fmtNum(n, 0)}ms`
}
const stamp = () => new Date().toISOString().slice(0, 10)
const csvName = (base, window) => `${base}_${window}_${stamp()}.csv`

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function fetchJsonWithRetry(url, options = {}, cfg = {}) {
  const { retries = 2, timeoutMs = 8000, backoffMs = 300 } = cfg

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController()
    const t = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(url, { ...options, signal: controller.signal })
      if (!res.ok) {
        // Retry only transient/server/rate errors
        if ((res.status === 429 || res.status >= 500) && attempt < retries) {
          await sleep(backoffMs * Math.pow(2, attempt))
          continue
        }
        const payload = await res.json().catch(() => ({}))
        throw new Error(payload?.detail || `HTTP ${res.status}`)
      }
      return await res.json()
    } catch (err) {
      const isAbort = err?.name === 'AbortError'
      if (attempt < retries) {
        await sleep(backoffMs * Math.pow(2, attempt))
        continue
      }
      throw new Error(isAbort ? 'Request timeout' : (err?.message || 'Request failed'))
    } finally {
      clearTimeout(t)
    }
  }

  throw new Error('Request failed')
}

function Dashboard() {
  const saved = loadSettings()

  const [stats, setStats] = useState(null)
  const [risk, setRisk] = useState(null)
  const [equity, setEquity] = useState([])
  const [balanceSeries, setBalanceSeries] = useState([])
  const [trades, setTrades] = useState([])
  const [positions, setPositions] = useState([])
  const [diag, setDiag] = useState(null)
  const [runtimeHealth, setRuntimeHealth] = useState(null)
  const [dbWritable, setDbWritable] = useState(null)
  const [execSummary, setExecSummary] = useState(null)
  const [audit, setAudit] = useState(null)
  const [execEvents, setExecEvents] = useState([])
  const [execErrorsSeries, setExecErrorsSeries] = useState([])
  const [execStatusFilter, setExecStatusFilter] = useState('')
  const [fundingTrend, setFundingTrend] = useState([])
  const [fundingTrendSource, setFundingTrendSource] = useState('unavailable')
  const [auditTradesMeta, setAuditTradesMeta] = useState({ total: 0, limit: 25, offset: 0, checksum: '' })
  const [syncEvents, setSyncEvents] = useState([])
  const [syncEventsMeta, setSyncEventsMeta] = useState({ total: 0, limit: 8, offset: 0 })
  const [syncEventsFilterEndpoint, setSyncEventsFilterEndpoint] = useState('')
  const [syncEventsFilterStatus, setSyncEventsFilterStatus] = useState('')
  const [debouncedSyncEndpoint, setDebouncedSyncEndpoint] = useState('')
  const [debouncedSyncStatus, setDebouncedSyncStatus] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState('')
  const [globalError, setGlobalError] = useState('')
  const [lastSuccessfulRefreshAt, setLastSuccessfulRefreshAt] = useState(null)
  const [syncErrorStreak, setSyncErrorStreak] = useState(0)
  const [autoSyncCooldownUntil, setAutoSyncCooldownUntil] = useState(null)
  const [heartbeatTestMsg, setHeartbeatTestMsg] = useState('')
  const [execIngestTestMsg, setExecIngestTestMsg] = useState('')
  const [staleBySection, setStaleBySection] = useState({ health: null, risk: null, tables: null, ops: null })
  const [integrationStatus, setIntegrationStatus] = useState({ heartbeatOk: null, executionOk: null, lastTestAt: null })
  const [fundingChartType, setFundingChartType] = useState('line')
  const [equityView, setEquityView] = useState(saved.equityView || 'realized_cumulative')
  const [exitMetricView, setExitMetricView] = useState(saved.exitMetricView || 'coverage')
  const [densityMode, setDensityMode] = useState(saved.densityMode || 'comfort')

  const [windowFilter, setWindowFilter] = useState(saved.windowFilter || '30d')
  const [refreshSec, setRefreshSec] = useState(saved.refreshSec || 'off')
  const [autoSyncSec, setAutoSyncSec] = useState(saved.autoSyncSec || 'off')
  const [alertThresholds, setAlertThresholds] = useState(saved.alertThresholds || DEFAULT_ALERT_THRESHOLDS)
  const [showSections, setShowSections] = useState(saved.showSections || DEFAULT_SHOW_SECTIONS)
  const [defaultPreset, setDefaultPreset] = useState(saved.defaultPreset || 'Full')
  const [quickMode, setQuickMode] = useState(saved.quickMode || false)
  const [opsAlert, setOpsAlert] = useState(null)
  const [opsAlertAck, setOpsAlertAck] = useState(false)
  const [opsIncidentLog, setOpsIncidentLog] = useState(saved.opsIncidentLog || [])
  const [syncToken, setSyncToken] = useState(saved.syncToken || '')
  const [symbolFilter, setSymbolFilter] = useState(saved.symbolFilter || '')
  const [debouncedSymbolFilter, setDebouncedSymbolFilter] = useState(saved.symbolFilter || '')
  const [tradeLimit, setTradeLimit] = useState(saved.tradeLimit || 25)
  const [tradeOffset, setTradeOffset] = useState(0)
  const [tradeTotal, setTradeTotal] = useState(0)
  const [tradeSortBy, setTradeSortBy] = useState(saved.tradeSortBy || 'executed_at')
  const [tradeSortDir, setTradeSortDir] = useState(saved.tradeSortDir || 'desc')

  const [manualRefreshLocked, setManualRefreshLocked] = useState(false)
  const lastManualRefreshAtRef = useRef(0)
  const refreshInFlightRef = useRef(false)
  const refreshQueuedRef = useRef(false)
  const tradesReqIdRef = useRef(0)
  const syncReqIdRef = useRef(0)
  const execReqIdRef = useRef(0)
  const errSeriesReqIdRef = useRef(0)
  const auditReqIdRef = useRef(0)

  const [positionSideFilter, setPositionSideFilter] = useState(saved.positionSideFilter || 'ALL')
  const [positionSortBy, setPositionSortBy] = useState(saved.positionSortBy || 'notional_usd')
  const [positionSortDir, setPositionSortDir] = useState(saved.positionSortDir || 'desc')

  const markStale = (section, ok) => {
    setStaleBySection((prev) => ({
      ...prev,
      [section]: ok ? null : (prev?.[section] || new Date().toISOString())
    }))
  }

  const loadBase = async () => {
    const reqs = await Promise.allSettled([
      fetchJsonWithRetry(`${API_URL}/stats/overview?window=${windowFilter}`),
      fetchJsonWithRetry(`${API_URL}/risk/exposure`),
      fetchJsonWithRetry(`${API_URL}/stats/equity?window=${windowFilter}`),
      fetchJsonWithRetry(`${API_URL}/stats/balance?window=${windowFilter}`),
      fetchJsonWithRetry(`${API_URL}/positions`),
      fetchJsonWithRetry(`${API_URL}/diagnostics/connectors`),
      fetchJsonWithRetry(`${API_URL}/health/runtime`),
      fetchJsonWithRetry(`${API_URL}/diagnostics/db-writable`),
      fetchJsonWithRetry(`${API_URL}/execution/summary?window=${windowFilter}`),
      fetchJsonWithRetry(`${API_URL}/funding/trend?window=${windowFilter}`),
      fetchJsonWithRetry(`${API_URL}/product/readiness?window=${windowFilter}`),
      fetchJsonWithRetry(`${API_URL}/audit/summary?window=${windowFilter}`)
    ])

    const pick = (idx, fallback = null) => (reqs[idx]?.status === 'fulfilled' ? reqs[idx].value : fallback)

    const overview = pick(0, null)
    const riskRes = pick(1, null)
    const equityRes = pick(2, { points: [] })
    const balanceRes = pick(3, { points: [] })
    const positionsRes = pick(4, [])
    const diagRes = pick(5, null)
    const runtimeRes = pick(6, null)
    const dbWritableRes = pick(7, null)
    const execRes = pick(8, null)
    const fundingTrendRes = pick(9, { points: [], source: 'unavailable' })
    const readinessRes = pick(10, null)
    const auditRes = pick(11, null)

    setStats(overview)
    setRisk(riskRes)
    setEquity(equityRes?.points || [])
    setBalanceSeries(balanceRes?.points || [])
    setPositions(pickList(positionsRes, ['positions']))
    setDiag(diagRes)
    setRuntimeHealth(runtimeRes)
    setDbWritable(dbWritableRes)
    setExecSummary(execRes)
    setFundingTrend(fundingTrendRes?.points || [])
    setFundingTrendSource(fundingTrendRes?.source || 'unavailable')
    setProductReadiness(readinessRes)
    setAudit(auditRes)

    const failed = reqs.filter((r) => r.status === 'rejected').length
    if (failed > 0) {
      setGlobalError(`Data degraded: ${failed} request(s) failed on last refresh`)
    } else {
      setGlobalError('')
      setLastSuccessfulRefreshAt(new Date().toISOString())
    }

    markStale('health', !!(runtimeRes && diagRes))
    markStale('risk', !!(overview && riskRes))
    markStale('tables', !!positionsRes)
    markStale('ops', !!execRes)
  }

  const loadAuditTradesMeta = () => {
    const reqId = ++auditReqIdRef.current
    const params = new URLSearchParams({
      window: windowFilter,
      limit: String(auditTradesMeta.limit),
      offset: String(auditTradesMeta.offset)
    })

    return fetchJsonWithRetry(`${API_URL}/audit/trades?${params.toString()}`)
      .then((res) => {
        if (reqId !== auditReqIdRef.current) return
        setAuditTradesMeta((p) => ({
          ...p,
          total: res?.total || 0,
          checksum: res?.page_checksum_sha256 || ''
        }))
      })
      .catch(() => {
        if (reqId !== auditReqIdRef.current) return
        setAuditTradesMeta((p) => ({ ...p, total: 0, checksum: '' }))
      })
  }

  const loadExecutionEvents = () => {
    const reqId = ++execReqIdRef.current
    const params = new URLSearchParams({ limit: '8', offset: '0' })
    if (execStatusFilter) params.append('status', execStatusFilter)

    return fetchJsonWithRetry(`${API_URL}/execution/events?${params.toString()}`)
      .then((res) => {
        if (reqId !== execReqIdRef.current) return
        setExecEvents(res?.events || [])
      })
      .catch(() => {
        if (reqId !== execReqIdRef.current) return
        setExecEvents([])
      })
  }

  const loadExecutionErrorsSeries = () => {
    const reqId = ++errSeriesReqIdRef.current
    return fetchJsonWithRetry(`${API_URL}/execution/errors-timeseries?window=${windowFilter}`)
      .then((res) => {
        if (reqId !== errSeriesReqIdRef.current) return
        setExecErrorsSeries(res?.points || [])
      })
      .catch(() => {
        if (reqId !== errSeriesReqIdRef.current) return
        setExecErrorsSeries([])
      })
  }

  const testBotHeartbeat = async () => {
    setHeartbeatTestMsg('')
    try {
      const headers = { 'Content-Type': 'application/json' }
      if (syncToken.trim()) headers['X-API-Token'] = syncToken.trim()

      const res = await fetch(`${API_URL}/health/heartbeat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ source: 'dashboard-test', status: 'ok', note: 'manual ui heartbeat test' })
      })

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        throw new Error(payload?.detail || `Heartbeat test failed (${res.status})`)
      }

      setHeartbeatTestMsg('Heartbeat test OK')
      setIntegrationStatus((p) => ({ ...p, heartbeatOk: true, lastTestAt: new Date().toISOString() }))
      loadBase()
    } catch (err) {
      setHeartbeatTestMsg(`Heartbeat test failed: ${err?.message || 'unknown error'}`)
      setIntegrationStatus((p) => ({ ...p, heartbeatOk: false, lastTestAt: new Date().toISOString() }))
    }
  }

  const testExecutionIngest = async () => {
    setExecIngestTestMsg('')
    try {
      const headers = { 'Content-Type': 'application/json' }
      if (syncToken.trim()) headers['X-API-Token'] = syncToken.trim()

      const res = await fetch(`${API_URL}/execution/events`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          source: 'dashboard-test',
          event_type: 'smoke_test',
          status: 'ok',
          latency_ms: 1,
          note: 'manual ui execution ingest test'
        })
      })

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        throw new Error(payload?.detail || `Execution ingest test failed (${res.status})`)
      }

      setExecIngestTestMsg('Execution ingest test OK')
      setIntegrationStatus((p) => ({ ...p, executionOk: true, lastTestAt: new Date().toISOString() }))
      loadExecutionEvents()
    } catch (err) {
      setExecIngestTestMsg(`Execution ingest test failed: ${err?.message || 'unknown error'}`)
      setIntegrationStatus((p) => ({ ...p, executionOk: false, lastTestAt: new Date().toISOString() }))
    }
  }

  const loadSyncEvents = () => {
    const reqId = ++syncReqIdRef.current
    const params = new URLSearchParams({
      limit: String(syncEventsMeta.limit),
      offset: String(syncEventsMeta.offset)
    })
    if (debouncedSyncEndpoint.trim()) params.append('endpoint', debouncedSyncEndpoint.trim())
    if (debouncedSyncStatus.trim()) params.append('status', debouncedSyncStatus.trim())

    return fetchJsonWithRetry(`${API_URL}/sync/events?${params.toString()}`)
      .then((res) => {
        if (reqId !== syncReqIdRef.current) return
        setSyncEvents(res?.events || [])
        setSyncEventsMeta((p) => ({ ...p, total: res?.total || 0 }))
      })
      .catch(() => {
        if (reqId !== syncReqIdRef.current) return
        setSyncEvents([])
        setSyncEventsMeta((p) => ({ ...p, total: 0 }))
      })
  }

  const loadTrades = () => {
    const reqId = ++tradesReqIdRef.current
    const params = new URLSearchParams({
      limit: String(tradeLimit),
      offset: String(tradeOffset),
      window: windowFilter,
      sort_by: tradeSortBy,
      sort_dir: tradeSortDir
    })
    if (debouncedSymbolFilter.trim()) params.append('symbol', debouncedSymbolFilter.trim().toUpperCase())

    return fetchJsonWithRetry(`${API_URL}/trades?${params.toString()}`)
      .then((res) => {
        if (reqId !== tradesReqIdRef.current) return
        setTrades(pickList(res, ['trades']))
        setTradeTotal(res?.total || 0)
      })
      .catch(() => {
        if (reqId !== tradesReqIdRef.current) return
        setTrades([])
        setTradeTotal(0)
      })
  }

  const refreshAll = async () => {
    if (refreshInFlightRef.current) {
      refreshQueuedRef.current = true
      return
    }

    refreshInFlightRef.current = true
    try {
      await Promise.allSettled([
        Promise.resolve(loadBase()),
        Promise.resolve(loadTrades()),
        Promise.resolve(loadAuditTradesMeta()),
        Promise.resolve(loadSyncEvents()),
        Promise.resolve(loadExecutionEvents()),
        Promise.resolve(loadExecutionErrorsSeries())
      ])
    } finally {
      refreshInFlightRef.current = false
      if (refreshQueuedRef.current) {
        refreshQueuedRef.current = false
        refreshAll()
      }
    }
  }

  const manualRefreshAll = () => {
    const now = Date.now()
    if (now - lastManualRefreshAtRef.current < 500) return
    lastManualRefreshAtRef.current = now
    setManualRefreshLocked(true)
    refreshAll()
    setTimeout(() => setManualRefreshLocked(false), 500)
  }

  const syncNow = async () => {
    setSyncing(true)
    setSyncError('')
    let timeoutId
    try {
      const headers = {}
      if (syncToken.trim()) headers['X-API-Token'] = syncToken.trim()

      const controller = new AbortController()
      timeoutId = setTimeout(() => controller.abort(), 90000)

      const res = await fetch(`${API_URL}/sync/scan-all-symbols?limit=120&lookback_days=30&max_recent_symbols=60&per_symbol_delay_ms=250`, { method: 'POST', headers, signal: controller.signal })

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        throw new Error(payload?.detail || `Sync failed (${res.status})`)
      }
      setSyncErrorStreak(0)
      setAutoSyncCooldownUntil(null)
      setGlobalError('')
      refreshAll()
    } catch (err) {
      const nextStreak = syncErrorStreak + 1
      setSyncErrorStreak(nextStreak)
      if (nextStreak >= 3) {
        setAutoSyncCooldownUntil(Date.now() + 10 * 60 * 1000)
      }

      if (err?.name === 'AbortError') {
        setSyncError('Sync timeout after 90s. Reduce symbols or retry.')
      } else {
        setSyncError(err?.message || 'Sync failed')
      }
    } finally {
      if (timeoutId) clearTimeout(timeoutId)
      setSyncing(false)
    }
  }

  useEffect(() => {
    refreshAll()
  }, [windowFilter])

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSymbolFilter(symbolFilter), 250)
    return () => clearTimeout(id)
  }, [symbolFilter])

  useEffect(() => {
    setTradeOffset(0)
  }, [debouncedSymbolFilter, tradeLimit, windowFilter, tradeSortBy, tradeSortDir])

  useEffect(() => {
    loadTrades()
  }, [debouncedSymbolFilter, tradeLimit, tradeOffset, windowFilter, tradeSortBy, tradeSortDir])

  useEffect(() => {
    loadAuditTradesMeta()
  }, [windowFilter, auditTradesMeta.limit, auditTradesMeta.offset])

  useEffect(() => {
    const id = setTimeout(() => {
      setDebouncedSyncEndpoint(syncEventsFilterEndpoint)
      setDebouncedSyncStatus(syncEventsFilterStatus)
    }, 250)
    return () => clearTimeout(id)
  }, [syncEventsFilterEndpoint, syncEventsFilterStatus])

  useEffect(() => {
    loadSyncEvents()
  }, [syncEventsMeta.limit, syncEventsMeta.offset, debouncedSyncEndpoint, debouncedSyncStatus])

  useEffect(() => {
    loadExecutionEvents()
  }, [execStatusFilter])

  useEffect(() => {
    if (refreshSec === 'off') return undefined
    const ms = Number(refreshSec) * 1000
    const id = setInterval(() => {
      refreshAll()
    }, ms)
    return () => clearInterval(id)
  }, [refreshSec, windowFilter, symbolFilter, tradeLimit, tradeOffset, tradeSortBy, tradeSortDir, auditTradesMeta.limit, auditTradesMeta.offset, syncEventsMeta.limit, syncEventsMeta.offset, syncEventsFilterEndpoint, syncEventsFilterStatus])

  useEffect(() => {
    if (autoSyncSec === 'off') return undefined
    const ms = Number(autoSyncSec) * 1000
    const id = setInterval(() => {
      if (syncing) return
      if (diag && !diag?.sync?.can_sync) return
      if (autoSyncCooldownUntil && Date.now() < autoSyncCooldownUntil) return
      syncNow()
    }, ms)
    return () => clearInterval(id)
  }, [autoSyncSec, syncing, diag, syncToken, autoSyncCooldownUntil])

  const ddColor = useMemo(() => ((stats?.max_drawdown_pct || 0) > alertThresholds.ddPct ? '#ff3131' : '#ffae00'), [stats, alertThresholds])

  const alerts = useMemo(() => {
    const out = []
    if ((stats?.max_drawdown_pct || 0) > alertThresholds.ddPct) {
      out.push({ level: 'HIGH', msg: `Drawdown élevé: ${stats.max_drawdown_pct}% (> ${alertThresholds.ddPct}%)` })
    }
    if ((risk?.top_symbol_share_pct || 0) > alertThresholds.concentrationPct) {
      out.push({ level: 'MED', msg: `Concentration symbole élevée: ${risk.top_symbol_share_pct}% (> ${alertThresholds.concentrationPct}%)` })
    }
    if ((risk?.leverage_weighted || 0) > alertThresholds.leverageWeighted) {
      out.push({ level: 'HIGH', msg: `Levier pondéré élevé: ${risk.leverage_weighted}x (> ${alertThresholds.leverageWeighted}x)` })
    }
    if ((stats?.fee_drag_pct || 0) > alertThresholds.feeDragPct) {
      out.push({ level: 'MED', msg: `Fee drag élevé: ${Number(stats?.fee_drag_pct || 0).toFixed(2)}% (> ${alertThresholds.feeDragPct}%)` })
    }
    if ((stats?.exit_exact_coverage_pct ?? 100) < 80) {
      out.push({ level: 'MED', msg: `Exit exact coverage faible: ${Number(stats?.exit_exact_coverage_pct ?? 0).toFixed(1)}% (< 80%)` })
    }
    if (!out.length) out.push({ level: 'OK', msg: 'Aucune alerte critique active' })
    return out
  }, [risk, stats, alertThresholds])

  const positionSummary = useMemo(() => {
    let longNotional = 0
    let shortNotional = 0
    let top = { symbol: 'n/a', notional: 0 }

    for (const p of positions) {
      const n = Number(p.notional_usd || 0)
      if (p.side === 'LONG') longNotional += n
      else shortNotional += n
      if (n > top.notional) top = { symbol: p.symbol, notional: n }
    }

    return { longNotional, shortNotional, top }
  }, [positions])

  const winRateProxyPct = useMemo(() => {
    const closed = Number(stats?.total_closed_trades ?? 0)
    const tpLike = Number(stats?.exit_tp_like_count ?? 0)
    if (closed <= 0) return 0
    return (tpLike / closed) * 100
  }, [stats])

  const equityChart = useMemo(() => {
    const eq = (equity || []).map((p) => ({ ts: p.ts, value: Number(p.equity ?? 0) }))

    const bal = (balanceSeries || []).map((p) => ({
      ts: p.ts,
      value: Number(p.wallet_balance ?? p.equity_total ?? 0)
    }))

    const sortedTrades = [...(trades || [])].sort((a, b) => new Date(a.executed_at) - new Date(b.executed_at))

    const wrSeries = []
    const pfSeries = []
    const rTradeSeries = []

    let wins = 0
    let total = 0
    let grossWin = 0
    let grossLoss = 0
    let cumR = 0

    const rDenom = Math.max(0.000001, Number(stats?.avg_r_loss_usd ?? 1))

    for (const t of sortedTrades) {
      const pnl = Number(t.realized_pnl ?? 0)
      total += 1
      if (pnl > 0) wins += 1
      if (pnl > 0) grossWin += pnl
      if (pnl < 0) grossLoss += Math.abs(pnl)

      const wr = total > 0 ? (wins / total) * 100 : 0
      const pf = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? grossWin : 0)
      const r = pnl / rDenom
      cumR += r
      const avgR = total > 0 ? cumR / total : 0

      const ts = t.executed_at
      wrSeries.push({ ts, value: wr })
      pfSeries.push({ ts, value: pf })
      rTradeSeries.push({ ts, value: avgR })
    }

    const alignLastTo = (series, target) => {
      if (!series?.length) return series
      const currentLast = Number(series[series.length - 1]?.value ?? 0)
      const tgt = Number(target ?? currentLast)
      if (!Number.isFinite(currentLast) || !Number.isFinite(tgt)) return series
      const scale = currentLast === 0 ? 1 : tgt / currentLast
      return series.map((p) => ({ ...p, value: p.value * scale }))
    }

    const wrAligned = alignLastTo(wrSeries, Number(stats?.exit_tp_like_count ?? 0) + Number(stats?.exit_sl_like_count ?? 0) > 0 ? (Number(stats?.exit_tp_like_count ?? 0) / Math.max(1, Number(stats?.exit_tp_like_count ?? 0) + Number(stats?.exit_sl_like_count ?? 0) + Number(stats?.exit_other_count ?? 0))) * 100 : null)
    const pfAligned = alignLastTo(pfSeries, Number(stats?.profit_factor ?? 0))
    const rAligned = alignLastTo(rTradeSeries, Number(stats?.avg_r_by_trade_pct ?? 0))

    const cfg = {
      realized_cumulative: { label: 'Realized Cumulative', data: eq, color: '#00f3ff', note: '' },
      total_balance: {
        label: 'Total Balance',
        data: bal,
        color: '#8ab4ff',
        note: bal.length ? 'wallet balance snapshots' : 'no balance snapshots yet'
      },
      wr: { label: 'Evolution WR', data: wrAligned, color: '#39ff14', note: 'aligned to card value' },
      pf: { label: 'Evolution PF', data: pfAligned, color: '#ffd166', note: 'aligned to card value' },
      r_by_trade: { label: 'Evolution R by trade', data: rAligned, color: '#b026ff', note: 'aligned to card value' }
    }

    return cfg[equityView] || cfg.realized_cumulative
  }, [equity, balanceSeries, trades, stats?.avg_r_loss_usd, stats?.avg_r_by_trade_pct, stats?.profit_factor, stats?.exit_tp_like_count, stats?.exit_sl_like_count, stats?.exit_other_count, equityView])

  const freshness = useMemo(() => {
    const now = Date.now()
    const lastSyncMs = diag?.sync?.last_sync_at ? new Date(diag.sync.last_sync_at).getTime() : null
    const hbAgeSec = Number(runtimeHealth?.heartbeat_age_sec ?? NaN)
    const syncAgeMin = Number.isFinite(lastSyncMs) ? Math.max(0, (now - lastSyncMs) / 60000) : null
    const hbAgeMin = Number.isFinite(hbAgeSec) ? hbAgeSec / 60 : null
    return { syncAgeMin, hbAgeMin }
  }, [diag?.sync?.last_sync_at, runtimeHealth?.heartbeat_age_sec])

  const healthScore = useMemo(() => {
    if (!stats || !execSummary || !runtimeHealth || !diag) return null

    let score = 100
    const dd = Number(stats?.current_drawdown_pct ?? 0)
    const execErr = Number(execSummary?.error_events_1h ?? 0)
    const hbAgeSec = Number(runtimeHealth?.heartbeat_age_sec ?? 9999)
    const canSync = diag?.sync?.can_sync !== false

    score -= Math.min(40, dd * 2)
    score -= Math.min(25, execErr * 8)
    if (hbAgeSec > 300) score -= 20
    if (!canSync) score -= 20

    return Math.max(0, Math.round(score))
  }, [stats, execSummary, runtimeHealth, diag])

  const healthTone = healthScore == null ? '#ffd166' : (healthScore >= 80 ? '#39ff14' : healthScore >= 55 ? '#ffd166' : '#ff6b6b')

  const exitMetricCard = useMemo(() => {
    switch (exitMetricView) {
      case 'exact_count':
        return { label: 'EXIT EXACT COUNT', value: `${Number(stats?.exit_exact_count ?? 0)}`, color: '#39ff14' }
      case 'proxy_count':
        return { label: 'EXIT PROXY COUNT', value: `${Number(stats?.exit_proxy_count ?? 0)}`, color: '#ff9f9f' }
      case 'other_count':
        return { label: 'EXIT OTHER', value: `${Number(stats?.exit_other_count ?? 0)}`, color: '#ffd166' }
      case 'source':
        return { label: 'EXIT SOURCE', value: `${stats?.exit_reason_source || 'n/a'}`, color: '#8ab4ff' }
      case 'coverage':
      default:
        return {
          label: 'EXIT EXACT COVERAGE',
          value: `${Number(stats?.exit_exact_coverage_pct ?? 0).toFixed(1)}%`,
          color: Number(stats?.exit_exact_coverage_pct ?? 0) >= 80 ? '#39ff14' : '#ffd166'
        }
    }
  }, [exitMetricView, stats?.exit_exact_count, stats?.exit_proxy_count, stats?.exit_other_count, stats?.exit_reason_source, stats?.exit_exact_coverage_pct])

  const visiblePositions = useMemo(() => {
    const filtered = positions.filter((p) => positionSideFilter === 'ALL' || p.side === positionSideFilter)

    const val = (p) => {
      if (positionSortBy === 'symbol') return String(p.symbol || '')
      return Number(p[positionSortBy] || 0)
    }

    filtered.sort((a, b) => {
      const av = val(a)
      const bv = val(b)
      if (typeof av === 'string' || typeof bv === 'string') {
        return positionSortDir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av))
      }
      return positionSortDir === 'asc' ? av - bv : bv - av
    })

    return filtered
  }, [positions, positionSideFilter, positionSortBy, positionSortDir])

  useEffect(() => {
    const payload = {
      windowFilter,
      refreshSec,
      alertThresholds,
      symbolFilter,
      tradeLimit,
      tradeSortBy,
      tradeSortDir,
      positionSideFilter,
      positionSortBy,
      positionSortDir,
      syncToken,
      autoSyncSec,
      showSections,
      defaultPreset,
      staleBySection,
      quickMode,
      opsIncidentLog,
      integrationStatus,
      fundingChartType,
      equityView,
      exitMetricView,
      densityMode
    }
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(payload))
  }, [windowFilter, refreshSec, alertThresholds, symbolFilter, tradeLimit, tradeSortBy, tradeSortDir, positionSideFilter, positionSortBy, positionSortDir, syncToken, autoSyncSec, showSections, defaultPreset, quickMode, opsIncidentLog, integrationStatus, fundingChartType, equityView, exitMetricView, densityMode])

  const resetUiSettings = () => {
    localStorage.removeItem(SETTINGS_KEY)
    setWindowFilter('30d')
    setRefreshSec('off')
    setAlertThresholds(DEFAULT_ALERT_THRESHOLDS)
    setSyncToken('')
    setSymbolFilter('')
    setTradeLimit(25)
    setTradeOffset(0)
    setTradeSortBy('executed_at')
    setTradeSortDir('desc')
    setPositionSideFilter('ALL')
    setPositionSortBy('notional_usd')
    setPositionSortDir('desc')
    setAutoSyncSec('off')
    setShowSections(DEFAULT_SHOW_SECTIONS)
    setDefaultPreset('Full')
    setQuickMode(false)
    setOpsAlert(null)
    setOpsAlertAck(false)
    setOpsIncidentLog([])
    setIntegrationStatus({ heartbeatOk: null, executionOk: null, lastTestAt: null })
    setFundingChartType('line')
    setEquityView('realized_cumulative')
    setExitMetricView('coverage')
    setDensityMode('comfort')
  }

  useEffect(() => {
    if (!quickMode) {
      setOpsAlert(null)
      return
    }

    const errors1h = Number(execSummary?.error_events_1h ?? 0)
    const missed = Number(execSummary?.missed_like_events ?? 0)
    const hasOpsIssue = errors1h > 0 || missed > 0

    if (hasOpsIssue) {
      setShowSections(SECTION_PRESETS.Ops)

      const reason = `errors_1h=${errors1h}, missed_like=${missed}`
      setOpsAlert({ reason, at: new Date().toISOString() })
      setOpsAlertAck(false)

      setOpsIncidentLog((prev) => {
        const row = { at: new Date().toISOString(), reason }
        return [row, ...(prev || [])].slice(0, 30)
      })
    } else {
      setShowSections(SECTION_PRESETS.Core)
      setOpsAlert(null)
    }
  }, [quickMode, execSummary?.error_events_1h, execSummary?.missed_like_events])

  const scrollToSection = (id) => {
    const el = document.getElementById(id)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0a0a0f',
        color: 'white',
        padding: 24,
        ['--card-pad']: densityMode === 'compact' ? '12px' : '20px',
        ['--card-label-size']: densityMode === 'compact' ? '12px' : '14px',
        ['--card-value-size']: densityMode === 'compact' ? '22px' : '28px'
      }}
    >
      <style>{`
        input, select, button { outline: none; }
        input:focus, select:focus, button:focus {
          box-shadow: 0 0 0 2px #00f3ff66;
          border-color: #00f3ff !important;
        }
      `}</style>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h1 style={{ color: '#b026ff', textShadow: '0 0 10px #b026ff', marginTop: 0, marginBottom: 0 }}>⚡ BANJO TRADING DASHBOARD</h1>
          <span style={{ background: '#1a1a2e', border: '1px solid #3a3a55', color: '#cfd3ff', borderRadius: 999, padding: '4px 10px', fontSize: 12, fontWeight: 700 }}>
            Window: {String(windowFilter || '').toUpperCase()}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Badge ok={diag?.db?.status === 'ok'} label={`DB: ${diag?.db?.status || 'unknown'}`} />
          <Badge ok={diag?.binance?.status === 'configured'} label={`BINANCE: ${diag?.binance?.status || 'unknown'}`} />
          <Badge ok={diag?.sync?.role === 'operator'} label={`ROLE: ${(diag?.sync?.role || 'operator').toUpperCase()}`} />
          <Badge ok={!diag?.sync?.read_only} label={diag?.sync?.read_only ? 'MODE: READ-ONLY' : 'MODE: ACTIVE'} />
          <select value={windowFilter} onChange={(e) => setWindowFilter(e.target.value)} style={{ background: '#1a1a2e', border: '1px solid #2a2a3f', color: '#fff', borderRadius: 8, padding: '8px 10px' }}>
            <option value='24h'>24H</option>
            <option value='7d'>7D</option>
            <option value='30d'>30D</option>
            <option value='90d'>90D</option>
            <option value='all'>ALL</option>
          </select>
          <select value={refreshSec} onChange={(e) => setRefreshSec(e.target.value)} style={{ background: '#1a1a2e', border: '1px solid #2a2a3f', color: '#fff', borderRadius: 8, padding: '8px 10px' }}>
            <option value='off'>Auto-refresh: off</option>
            <option value='10'>Auto-refresh: 10s</option>
            <option value='30'>Auto-refresh: 30s</option>
            <option value='60'>Auto-refresh: 60s</option>
          </select>
          <select value={autoSyncSec} onChange={(e) => setAutoSyncSec(e.target.value)} style={{ background: '#1a1a2e', border: '1px solid #2a2a3f', color: '#fff', borderRadius: 8, padding: '8px 10px' }}>
            <option value='off'>Auto-sync: off</option>
            <option value='60'>Auto-sync: 60s</option>
          </select>
          {(diag?.sync?.token_required ?? true) && (
            <input
              value={syncToken}
              onChange={(e) => setSyncToken(e.target.value)}
              placeholder='Sync token'
              style={{ background: '#1a1a2e', border: '1px solid #2a2a3f', color: '#fff', borderRadius: 8, padding: '8px 10px' }}
            />
          )}
          <button onClick={syncNow} disabled={syncing || (diag ? !diag?.sync?.can_sync : false) || (dbWritable?.is_writable === false)} style={{ background: '#00f3ff', color: '#000', border: 'none', borderRadius: 8, padding: '8px 12px', fontWeight: 700, opacity: syncing || (diag ? !diag?.sync?.can_sync : false) || (dbWritable?.is_writable === false) ? 0.5 : 1 }}>
            {syncing ? 'Syncing...' : 'Sync now'}
          </button>
          <button onClick={resetUiSettings} style={{ background: '#2d2d45', color: '#fff', border: '1px solid #444466', borderRadius: 8, padding: '8px 12px', fontWeight: 700 }}>
            Reset UI
          </button>
        </div>
      </div>

      {globalError && (
        <div style={{ ...panelStyle(), marginTop: 10, border: '1px solid #ff6b6b', background: '#2b1212', color: '#ffdede' }}>
          <strong>Runtime warning:</strong> {globalError}
          {lastSuccessfulRefreshAt && (
            <span style={{ marginLeft: 10, color: '#ffb3b3' }}>Last good refresh: {new Date(lastSuccessfulRefreshAt).toLocaleTimeString()}</span>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 10, color: '#b7bbd8', fontSize: 13, alignItems: 'center' }}>
        <span>Preset:</span>
        {Object.entries(SECTION_PRESETS).map(([name, conf]) => (
          <button
            key={name}
            onClick={() => {
              setShowSections(conf)
              setDefaultPreset(name)
            }}
            style={{ background: '#1a1a2e', color: '#fff', border: '1px solid #2a2a3f', borderRadius: 999, padding: '4px 10px', fontSize: 12, fontWeight: 700 }}
          >
            {name}
          </button>
        ))}
        <span style={{ marginLeft: 8 }}>Default:</span>
        <select value={defaultPreset} onChange={(e) => {
          const name = e.target.value
          setDefaultPreset(name)
          if (SECTION_PRESETS[name]) setShowSections(SECTION_PRESETS[name])
        }} style={{ background: '#1a1a2e', border: '1px solid #2a2a3f', color: '#fff', borderRadius: 8, padding: '4px 8px' }}>
          {Object.keys(SECTION_PRESETS).map((name) => (<option key={name} value={name}>{name}</option>))}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type='checkbox' checked={!!quickMode} onChange={(e) => setQuickMode(e.target.checked)} />
          Quick mode
        </label>
        <span style={{ marginLeft: 8 }}>Density:</span>
        <select value={densityMode} onChange={(e) => setDensityMode(e.target.value)} style={{ background: '#1a1a2e', border: '1px solid #2a2a3f', color: '#fff', borderRadius: 8, padding: '4px 8px' }}>
          <option value='comfort'>Comfort</option>
          <option value='compact'>Compact</option>
        </select>
        <span style={{ marginLeft: 8 }}>Custom:</span>
        {Object.entries(showSections).map(([k, v]) => (
          <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type='checkbox' checked={!!v} onChange={(e) => setShowSections((p) => ({ ...p, [k]: e.target.checked }))} />
            {k}
          </label>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        <button onClick={() => scrollToSection('sec-health')} style={{ background: '#1a1a2e', color: '#fff', border: '1px solid #2a2a3f', borderRadius: 999, padding: '4px 10px', fontSize: 12 }}>Health</button>
        <button onClick={() => scrollToSection('sec-risk')} style={{ background: '#1a1a2e', color: '#fff', border: '1px solid #2a2a3f', borderRadius: 999, padding: '4px 10px', fontSize: 12 }}>Risk/Perf</button>
        <button onClick={() => scrollToSection('sec-market')} style={{ background: '#1a1a2e', color: '#fff', border: '1px solid #2a2a3f', borderRadius: 999, padding: '4px 10px', fontSize: 12 }}>Market</button>
        <button onClick={() => scrollToSection('sec-tables')} style={{ background: '#1a1a2e', color: '#fff', border: '1px solid #2a2a3f', borderRadius: 999, padding: '4px 10px', fontSize: 12 }}>Tables</button>
        <button onClick={() => scrollToSection('sec-ops')} style={{ background: '#1a1a2e', color: '#fff', border: '1px solid #2a2a3f', borderRadius: 999, padding: '4px 10px', fontSize: 12 }}>Ops</button>
      </div>

      <div style={{ ...panelStyle(), marginTop: 10, border: `1px solid ${healthTone}55` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', color: '#cfd3ff', fontSize: 13 }}>
            <span>Data freshness</span>
            <span>Last sync age: <strong>{freshness.syncAgeMin == null ? 'n/a' : `${freshness.syncAgeMin.toFixed(1)}m`}</strong></span>
            <span>Heartbeat age: <strong>{freshness.hbAgeMin == null ? 'n/a' : `${freshness.hbAgeMin.toFixed(1)}m`}</strong></span>
            <span>API mode: <strong>{diag ? (diag?.sync?.read_only ? 'read-only' : 'active') : 'unknown'}</strong></span>
          </div>
          <div style={{ color: healthTone, fontWeight: 800 }}>
            HEALTH SCORE: {healthScore == null ? 'N/A (degraded)' : `${healthScore}/100`}
          </div>
        </div>
      </div>

      {quickMode && opsAlert && !opsAlertAck && (
        <div style={{ ...panelStyle(), border: '1px solid #ff6b6b', background: '#2b1212' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <strong style={{ color: '#ff6b6b' }}>Quick mode switched to OPS:</strong> {opsAlert.reason}
            </div>
            <button
              onClick={() => setOpsAlertAck(true)}
              style={{ background: '#ff6b6b', color: '#000', border: 'none', borderRadius: 8, padding: '6px 10px', fontWeight: 700 }}
            >
              Acknowledge
            </button>
          </div>
        </div>
      )}

      {((diag && !diag?.sync?.can_sync) || (dbWritable?.is_writable === false) || syncError) && (
        <div style={{ ...panelStyle(), border: '1px solid #ff6b6b' }}>
          {(diag && !diag?.sync?.can_sync) && (
            <div>
              <strong style={{ color: '#ff6b6b' }}>Sync locked:</strong>{' '}
              {diag?.sync?.can_sync_reason === 'app_read_only'
                ? 'application is in read-only mode (APP_READ_ONLY=true).'
                : diag?.sync?.can_sync_reason === 'role_viewer'
                  ? 'current role is viewer (APP_ROLE=viewer).'
                  : 'role/mode does not allow operator actions.'}
            </div>
          )}
          {dbWritable?.is_writable === false && (
            <div>
              <strong style={{ color: '#ff6b6b' }}>Sync disabled:</strong> database is readonly. Fix file/directory permissions first.
            </div>
          )}
          {syncError && (
            <div><strong style={{ color: '#ff6b6b' }}>Sync error:</strong> {syncError}</div>
          )}
          {autoSyncCooldownUntil && Date.now() < autoSyncCooldownUntil && (
            <div><strong style={{ color: '#ffd166' }}>Auto-sync cooldown:</strong> active until {new Date(autoSyncCooldownUntil).toLocaleTimeString()} after repeated sync errors.</div>
          )}
        </div>
      )}

      {quickMode && opsIncidentLog?.length > 0 && (
        <div style={{ ...panelStyle(), marginTop: 10 }}>
          <h3 style={{ marginTop: 0, color: '#c8c8ff' }}>Ops incidents (recent)</h3>
          <ul style={{ margin: 0, paddingLeft: 18, color: '#b7bbd8' }}>
            {opsIncidentLog.slice(0, 5).map((it, idx) => (
              <li key={`${it.at}-${idx}`} style={{ marginBottom: 4 }}>
                <strong>{new Date(it.at).toLocaleTimeString()}</strong> — {it.reason}
              </li>
            ))}
          </ul>
        </div>
      )}


      {showSections.health && (
        <>
          {staleBySection.health && (
        <div style={{ marginTop: 10, color: '#ffd166', fontSize: 12 }}>
          stale: health section (last ok before {new Date(staleBySection.health).toLocaleTimeString()})
        </div>
      )}

      <div id='sec-health' style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 18, marginTop: 18 }}>
            <Card label='BOT STATUS' value={(runtimeHealth?.bot_status || 'unknown').toUpperCase()} color={runtimeHealth?.bot_status === 'running' ? '#39ff14' : runtimeHealth?.bot_status === 'degraded' ? '#ffd166' : '#ff6b6b'} />
            <Card label='AVG EXEC LATENCY' value={execSummary?.avg_latency_ms == null ? 'n/a' : fmtLatency(execSummary.avg_latency_ms)} color='#c8c8ff' />
            <Card label='OPEN POSITIONS' value={runtimeHealth?.open_positions_count ?? 0} color='#b026ff' />
            <Card label='API ERRORS (24h)' value={runtimeHealth?.api_errors_24h ?? 0} color={Number(runtimeHealth?.api_errors_24h ?? 0) > 0 ? '#ff6b6b' : '#39ff14'} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 18, marginTop: 18 }}>
            <Card label='BALANCE (Wallet)' value={stats?.account_balance_wallet == null ? 'n/a' : fmtUsd(stats.account_balance_wallet)} color='#8ab4ff' />
            <Card label='AVG R / TRADE' value={`${Number(stats?.avg_r_by_trade_pct ?? 0).toFixed(2)}R`} color={Number(stats?.avg_r_by_trade_pct ?? 0) >= 0 ? '#39ff14' : '#ff6b6b'} />
            <Card label='WR (Proxy)' value={fmtPct(winRateProxyPct, 1)} color={winRateProxyPct >= 50 ? '#39ff14' : '#ffd166'} />
            <Card label='PROFIT FACTOR' value={stats?.profit_factor == null ? 'n/a' : Number(stats.profit_factor).toFixed(2)} color='#ffd166' />
          </div>

          <div style={panelStyle()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <h3 style={{ marginTop: 0, color: '#c8c8ff', marginBottom: 0 }}>Equity curve ({windowFilter})</h3>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <select value={equityView} onChange={(e) => setEquityView(e.target.value)} style={{ background: '#1a1a2e', border: '1px solid #2a2a3f', color: '#fff', borderRadius: 8, padding: '6px 10px' }}>
                  <option value='realized_cumulative'>Realized Cumulative</option>
                  <option value='total_balance'>Total Balance</option>
                  <option value='r_by_trade'>Evolution R by trade</option>
                  <option value='wr'>Evolution WR</option>
                  <option value='pf'>Evolution PF</option>
                </select>
                <button onClick={() => exportCsv(csvName('equity', windowFilter), equityChart.data)} style={{ background: '#8ab4ff', color: '#000', border: 'none', borderRadius: 8, padding: '8px 12px', fontWeight: 700 }}>Export CSV</button>
              </div>
            </div>
            <div style={{ color: '#8b8ba7', fontSize: 12, marginBottom: 8 }}>
              {equityChart.label}{equityChart.note ? ` · ${equityChart.note}` : ''}
            </div>
            <div style={{ width: '100%', height: 260 }}>
              <ResponsiveContainer>
                <LineChart data={equityChart.data}>
                  <XAxis dataKey='ts' tick={{ fill: '#888' }} />
                  <YAxis tick={{ fill: '#888' }} />
                  <Tooltip />
                  <Line type='monotone' dataKey='value' stroke={equityChart.color} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {false && (
          <div style={panelStyle()}>
            <h3 style={{ marginTop: 0, color: '#c8c8ff' }}>Runtime diagnostics</h3>
            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', color: '#cfd3ff' }}>
              <span>Last sync: <strong>{diag?.sync?.last_sync_at ? new Date(diag.sync.last_sync_at).toLocaleString() : 'n/a'}</strong></span>
              <span>DB latency: <strong>{diag?.db?.latency_ms ?? 'n/a'} ms</strong></span>
              <span>Server time: <strong>{diag?.sync?.server_time ? new Date(diag.sync.server_time).toLocaleString() : 'n/a'}</strong></span>
              <span>Min sync interval: <strong>{diag?.sync?.min_interval_seconds ?? 'n/a'}s</strong></span>
              <span>Heartbeat source: <strong>{runtimeHealth?.last_heartbeat_source || 'n/a'}</strong></span>
              <span>Heartbeat status: <strong>{runtimeHealth?.last_heartbeat_status || 'n/a'}</strong></span>
              {dbWritable?.is_writable === false && (
                <span style={{ color: '#ff6b6b' }}><strong>DB writable:</strong> NO (file/dir permissions)</span>
              )}
            </div>
            {dbWritable?.is_writable === false && (
              <div style={{ marginTop: 10, padding: 10, border: '1px solid #ff6b6b', borderRadius: 8, background: '#2b1212', color: '#ffdede', fontSize: 13 }}>
                <div style={{ marginBottom: 6 }}><strong>Quick fix hint</strong></div>
                <div style={{ marginBottom: 6 }}>DB path: <code>{dbWritable?.path || 'unknown'}</code></div>
                <div style={{ marginBottom: 4 }}><code>{`chmod u+rw "${dbWritable?.path || './backend/trading.db'}"`}</code></div>
                <div style={{ marginBottom: 4 }}><code>{`chmod u+rwx "${dbWritable?.path ? dbWritable.path.replace(/\/[^\/]+$/, '') : '.'}"`}</code></div>
                <div><code>{`sudo chown $USER:$USER "${dbWritable?.path || './backend/trading.db'}"`}</code></div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 10, color: '#b7bbd8' }}>
              <span>Data quality:</span>
              <span>R loss <strong>{stats?.data_quality?.avg_r_loss || 'n/a'}</strong></span>
              <span>R by trade <strong>{stats?.data_quality?.avg_r_by_trade || 'n/a'}</strong></span>
              <span>Exit dist <strong>{stats?.data_quality?.exit_distribution || 'n/a'}</strong></span>
              <span>Funding <strong>{stats?.data_quality?.funding_fees || 'n/a'}</strong></span>
            </div>
            <div style={{ marginTop: 8, color: '#b7bbd8', fontSize: 13 }}>
              Integration mode: <strong>{Number(stats?.exit_exact_coverage_pct ?? 0) > 0 ? 'API + Bot events (partial exact)' : 'API-only'}</strong>
            </div>
            <div style={{ marginTop: 8, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <button onClick={testBotHeartbeat} style={{ background: '#8ab4ff', color: '#000', border: 'none', borderRadius: 8, padding: '6px 10px', fontWeight: 700 }}>
                Test bot heartbeat
              </button>
              <button onClick={testExecutionIngest} style={{ background: '#ffd166', color: '#000', border: 'none', borderRadius: 8, padding: '6px 10px', fontWeight: 700 }}>
                Test execution ingest
              </button>
              {heartbeatTestMsg && <span style={{ color: heartbeatTestMsg.includes('OK') ? '#39ff14' : '#ff6b6b', fontSize: 13 }}>{heartbeatTestMsg}</span>}
              {execIngestTestMsg && <span style={{ color: execIngestTestMsg.includes('OK') ? '#39ff14' : '#ff6b6b', fontSize: 13 }}>{execIngestTestMsg}</span>}
            </div>
            <div style={{ marginTop: 8, display: 'flex', gap: 16, flexWrap: 'wrap', color: '#b7bbd8', fontSize: 13 }}>
              <span>Integration status:</span>
              <span>Heartbeat <strong style={{ color: integrationStatus.heartbeatOk == null ? '#c8c8ff' : (integrationStatus.heartbeatOk ? '#39ff14' : '#ff6b6b') }}>{integrationStatus.heartbeatOk == null ? 'n/a' : (integrationStatus.heartbeatOk ? 'OK' : 'FAIL')}</strong></span>
              <span>Execution ingest <strong style={{ color: integrationStatus.executionOk == null ? '#c8c8ff' : (integrationStatus.executionOk ? '#39ff14' : '#ff6b6b') }}>{integrationStatus.executionOk == null ? 'n/a' : (integrationStatus.executionOk ? 'OK' : 'FAIL')}</strong></span>
              <span>Last test <strong>{integrationStatus.lastTestAt ? new Date(integrationStatus.lastTestAt).toLocaleTimeString() : 'n/a'}</strong></span>
            </div>
          </div>
          )}
        </>
      )}

      {false && showSections.execution && (
        <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 18, marginTop: 18 }}>
        <Card label='EXEC EVENTS' value={execSummary?.total_events ?? 0} color='#8ab4ff' />
        <Card label='MISSED-LIKE (window)' value={execSummary?.missed_like_events ?? 0} color={Number(execSummary?.missed_like_events ?? 0) > 0 ? '#ff6b6b' : '#ffd166'} />
        <Card label='EXEC ERRORS (1h)' value={execSummary?.error_events_1h ?? 0} color={Number(execSummary?.error_events_1h ?? 0) > 0 ? '#ff6b6b' : '#39ff14'} />
        <Card label='AVG EXEC LATENCY' value={execSummary?.avg_latency_ms == null ? 'n/a' : `${Number(execSummary.avg_latency_ms).toFixed(0)}ms`} color='#c8c8ff' />
      </div>

      <div style={panelStyle()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h3 style={{ marginTop: 0, color: '#c8c8ff', marginBottom: 0 }}>Execution quality ({windowFilter})</h3>
          <select value={execStatusFilter} onChange={(e) => setExecStatusFilter(e.target.value)} style={{ background: '#1a1a2e', border: '1px solid #2a2a3f', color: '#fff', borderRadius: 8, padding: '8px 10px' }}>
            <option value=''>Events: all</option>
            <option value='ok'>Events: ok</option>
            <option value='error'>Events: error</option>
          </select>
        </div>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', color: '#cfd3ff', marginTop: 8 }}>
          <span>Total events: <strong>{execSummary?.total_events ?? 0}</strong></span>
          <span>Errors: <strong style={{ color: '#ff6b6b' }}>{execSummary?.error_events ?? 0}</strong></span>
          <span>Missed-like: <strong style={{ color: '#ff6b6b' }}>{execSummary?.missed_like_events ?? 0}</strong></span>
          <span>Avg latency: <strong>{execSummary?.avg_latency_ms == null ? 'n/a' : `${Number(execSummary.avg_latency_ms).toFixed(0)} ms`}</strong></span>
          <span>P50: <strong>{execSummary?.p50_latency_ms == null ? 'n/a' : `${execSummary.p50_latency_ms} ms`}</strong></span>
          <span>P95: <strong>{execSummary?.p95_latency_ms == null ? 'n/a' : `${execSummary.p95_latency_ms} ms`}</strong></span>
        </div>
        <div style={{ marginTop: 10, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ color: '#8b8ba7', textAlign: 'left', borderBottom: '1px solid #2a2a3f' }}>
                <th style={{ padding: 8, position: 'sticky', top: 0, background: '#10101a', zIndex: 2 }}>Time</th>
                <th style={{ padding: 8, position: 'sticky', top: 0, background: '#10101a', zIndex: 2 }}>Type</th>
                <th style={{ padding: 8, position: 'sticky', top: 0, background: '#10101a', zIndex: 2 }}>Status</th>
                <th style={{ padding: 8, position: 'sticky', top: 0, background: '#10101a', zIndex: 2 }}>Symbol</th>
                <th style={{ padding: 8, position: 'sticky', top: 0, background: '#10101a', zIndex: 2 }}>Latency</th>
                <th style={{ padding: 8, position: 'sticky', top: 0, background: '#10101a', zIndex: 2 }}>Error</th>
              </tr>
            </thead>
            <tbody>
              {execEvents.map((e, idx) => (
                <tr key={e.id} style={{ borderBottom: '1px solid #1c1c2b', background: idx % 2 === 0 ? 'transparent' : '#121223' }}>
                  <td style={{ padding: 8 }}>{e.created_at ? new Date(e.created_at).toLocaleString() : '-'}</td>
                  <td style={{ padding: 8 }}>{e.event_type}</td>
                  <td style={{ padding: 8, color: e.status === 'ok' ? '#39ff14' : '#ff6b6b' }}>{e.status}</td>
                  <td style={{ padding: 8 }}>{e.symbol || '-'}</td>
                  <td style={{ padding: 8 }}>{e.latency_ms ?? '-'} ms</td>
                  <td style={{ padding: 8, color: '#b7bbd8' }}>{e.error_message || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ width: '100%', height: 180, marginTop: 12 }}>
          <ResponsiveContainer>
            <BarChart data={execErrorsSeries}>
              <XAxis
                dataKey='ts'
                tick={{ fill: '#888', fontSize: 11 }}
                tickFormatter={(v) => {
                  const d = new Date(v)
                  return Number.isNaN(d.getTime()) ? v : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                }}
                minTickGap={24}
              />
              <YAxis tick={{ fill: '#888' }} allowDecimals={false} />
              <Tooltip
                labelFormatter={(v) => {
                  const d = new Date(v)
                  return Number.isNaN(d.getTime()) ? v : d.toLocaleString()
                }}
              />
              <Bar dataKey='errors' fill='#ff6b6b' maxBarSize={28} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      </>
      )}

      {showSections.riskPerf && (
        <>
      <div id='sec-risk' style={panelStyle()}>
        <h3 style={{ marginTop: 0, color: '#ffd166' }}>Risk strip</h3>
        {staleBySection.risk && <div style={{ color: '#ffd166', fontSize: 12, marginBottom: 8 }}>stale: risk section (last ok before {new Date(staleBySection.risk).toLocaleTimeString()})</div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <Card label='CURRENT DD' value={fmtPct(stats?.current_drawdown_pct ?? 0, 2)} color={Number(stats?.current_drawdown_pct ?? 0) > 0 ? '#ff6b6b' : '#39ff14'} />
          <Card label='MAX DD' value={fmtPct(stats?.max_drawdown_pct ?? 0, 2)} color='#ff9f9f' />
          <Card label='DD DURATION (max/current)' value={`${fmtH(stats?.max_dd_duration_hours ?? 0, 1)} / ${fmtH(stats?.current_dd_duration_hours ?? 0, 1)}`} color='#ffd166' />
          <Card label='LOSS STREAK (max/current)' value={`${Number(stats?.max_consecutive_losses ?? 0)} / ${Number(stats?.current_loss_streak ?? 0)}`} color='#ff9f9f' />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 18, marginTop: 24 }}>
        <Card label='POSITIONS' value={stats?.total_positions ?? 0} color='#b026ff' />
        <Card label='CLOSED POSITIONS' value={stats?.total_closed_trades ?? stats?.total_trades ?? 0} color='#00f3ff' />
        <Card label='REALIZED P&L' value={fmtUsd(stats?.total_realized_pnl ?? 0)} color={(stats?.total_realized_pnl ?? 0) >= 0 ? '#39ff14' : '#ff3131'} />
        <Card label='UNREALIZED P&L' value={fmtUsd(stats?.total_unrealized_pnl ?? 0)} color={(stats?.total_unrealized_pnl ?? 0) >= 0 ? '#39ff14' : '#ff3131'} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 18, marginTop: 18 }}>
        <Card label='NET P&L AFTER FEES' value={`$${Number(stats?.net_pnl_after_fees ?? 0).toFixed(2)}`} color={Number(stats?.net_pnl_after_fees ?? 0) >= 0 ? '#39ff14' : '#ff6b6b'} />
        <Card label='EXPECTANCY' value={`$${Number(stats?.expectancy ?? 0).toFixed(2)}`} color={Number(stats?.expectancy ?? 0) >= 0 ? '#39ff14' : '#ff6b6b'} />
        <Card label='AVG WIN/LOSS' value={stats?.avg_win_loss_ratio == null ? 'n/a' : Number(stats.avg_win_loss_ratio).toFixed(2)} color='#ffd166' />
        <Card label='MAX CONSEC WINS' value={`${Number(stats?.max_consecutive_wins ?? 0)}`} color='#8ab4ff' />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 18, marginTop: 18 }}>
        <Card label='TRADING FEES (Window)' value={fmtUsd(stats?.total_fees_window ?? 0)} color='#ff9f9f' />
        <Card label='FUNDING FEES (Window)' value={stats?.funding_fees_cumulative == null ? 'n/a' : fmtUsd(stats?.funding_fees_cumulative)} color='#c8c8ff' />
        <Card label='FEE DRAG' value={stats?.fee_drag_pct == null ? 'n/a' : fmtPct(stats.fee_drag_pct, 2)} color='#ff9f9f' />
        <Card label='FUNDING SHARE' value={stats?.funding_share_pct == null ? 'n/a' : fmtPct(stats.funding_share_pct, 2)} color='#8ab4ff' />
      </div>

      <div style={panelStyle()}>
        <h3 style={{ marginTop: 0, color: '#c8c8ff' }}>Cost mix ({windowFilter})</h3>
        <div style={{ height: 16, width: '100%', background: '#1a1a2e', border: '1px solid #2a2a3f', borderRadius: 999, overflow: 'hidden' }}>
          <div style={{ display: 'flex', height: '100%' }}>
            <div style={{ width: `${Number(stats?.funding_share_pct ?? 0)}%`, background: '#8ab4ff' }} />
            <div style={{ width: `${Number(stats?.trading_fee_share_pct ?? 0)}%`, background: '#ff9f9f' }} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 16, marginTop: 8, color: '#b7bbd8', fontSize: 13 }}>
          <span>Funding: <strong>{stats?.funding_share_pct == null ? 'n/a' : `${Number(stats.funding_share_pct).toFixed(2)}%`}</strong></span>
          <span>Trading fees: <strong>{stats?.trading_fee_share_pct == null ? 'n/a' : `${Number(stats.trading_fee_share_pct).toFixed(2)}%`}</strong></span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 18, marginTop: 18 }}>
        <Card label='FUNDING SOURCE' value={`${stats?.funding_fees_source || 'n/a'}`} color='#8ab4ff' />
        <Card label='TOP FUNDING SYMBOL' value={stats?.top_funding_symbol ? `${stats.top_funding_symbol} ($${Number(stats?.top_funding_fee_abs ?? 0).toFixed(2)})` : 'n/a'} color='#c8c8ff' />
        <Card label='BALANCE (wallet)' value={stats?.account_balance_wallet == null ? 'n/a' : `$${Number(stats.account_balance_wallet).toFixed(2)}`} color='#8ab4ff' />
        <Card label='AVAILABLE (est.)' value={stats?.account_available_est == null ? 'n/a' : `$${Number(stats.account_available_est).toFixed(2)}`} color='#7ce0ff' />
      </div>

      <div style={panelStyle()}>
        <h3 style={{ marginTop: 0, color: '#c8c8ff' }}>Top funding symbols ({windowFilter})</h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ color: '#8b8ba7', textAlign: 'left', borderBottom: '1px solid #2a2a3f' }}>
                <th style={{ padding: 8, position: 'sticky', top: 0, left: 0, background: '#10101a', zIndex: 3 }}>Symbol</th>
                <th style={{ padding: 8, position: 'sticky', top: 0, background: '#10101a', zIndex: 2 }}>Funding fee</th>
                <th style={{ padding: 8, position: 'sticky', top: 0, background: '#10101a', zIndex: 2 }}>Abs</th>
              </tr>
            </thead>
            <tbody>
              {(stats?.top_funding_symbols || []).map((row, idx) => (
                <tr key={row.symbol} style={{ borderBottom: '1px solid #1c1c2b', background: idx % 2 === 0 ? '#0f0f1a' : '#17172a' }} onMouseEnter={(e) => (e.currentTarget.style.background = '#23233a')} onMouseLeave={(e) => (e.currentTarget.style.background = idx % 2 === 0 ? '#0f0f1a' : '#17172a')}>
                  <td style={{ padding: 8, position: 'sticky', left: 0, background: '#141426', zIndex: 2, fontWeight: 700 }}>{row.symbol}</td>
                  <td style={{ padding: 8, color: Number(row.funding_fee) <= 0 ? '#ff6b6b' : '#39ff14' }}>${Number(row.funding_fee).toFixed(4)}</td>
                  <td style={{ padding: 8 }}>${Number(row.funding_fee_abs).toFixed(4)}</td>
                </tr>
              ))}
              {(!stats?.top_funding_symbols || stats.top_funding_symbols.length === 0) && (
                <tr>
                  <td style={{ padding: 8, color: '#8b8ba7' }} colSpan={3}>No funding data on selected window.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 18, marginTop: 18 }}>
        <Card label='MARGIN USED' value={fmtUsd(stats?.margin_used_positions ?? 0)} color='#ffd166' />
        <Card label='MAX DD (Window)' value={fmtPct(stats?.max_drawdown_pct ?? 0, 2)} color={ddColor} />
      </div>

      <div style={panelStyle()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h3 style={{ marginTop: 0, color: '#c8c8ff', marginBottom: 0 }}>Funding trend ({windowFilter})</h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ color: '#b7bbd8', fontSize: 13 }}>Chart</span>
            <select value={fundingChartType} onChange={(e) => setFundingChartType(e.target.value)} style={{ background: '#1a1a2e', border: '1px solid #2a2a3f', color: '#fff', borderRadius: 8, padding: '6px 8px' }}>
              <option value='line'>Line</option>
              <option value='bar'>Bar</option>
            </select>
          </div>
        </div>
        <div style={{ color: '#8b8ba7', fontSize: 12, marginBottom: 8 }}>
          Source: {fundingTrendSource} · Window total: ${Number((fundingTrend || []).reduce((acc, p) => acc + Number(p?.funding_fee || 0), 0)).toFixed(4)}
        </div>
        <div style={{ width: '100%', height: 180 }}>
          <ResponsiveContainer>
            {fundingChartType === 'bar' ? (
              <BarChart data={fundingTrend}>
                <XAxis dataKey='day' tick={{ fill: '#888', fontSize: 11 }} />
                <YAxis tick={{ fill: '#888' }} />
                <Tooltip />
                <Bar dataKey='funding_fee' fill='#8ab4ff' maxBarSize={28} />
              </BarChart>
            ) : (
              <LineChart data={fundingTrend}>
                <XAxis dataKey='day' tick={{ fill: '#888', fontSize: 11 }} />
                <YAxis tick={{ fill: '#888' }} />
                <Tooltip />
                <Line type='monotone' dataKey='funding_fee' stroke='#8ab4ff' dot={false} />
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 18, marginTop: 18 }}>
        <Card label='LAST ATH (Proxy)' value={stats?.last_ath_balance == null ? 'n/a' : fmtUsd(stats.last_ath_balance)} color='#ffd166' />
        <Card label='AVG R LOSS' value={fmtPct(stats?.avg_r_loss_pct ?? 0, 2)} color='#ff6b6b' />
        <Card label='AVG LOSS $ (Closed Pos)' value={fmtUsd(stats?.avg_r_loss_usd ?? 0)} color='#ff9f9f' />
        <Card label='R LOSS SOURCE' value={`${stats?.avg_r_loss_source || 'n/a'} (${stats?.avg_r_loss_verified_samples ?? 0})`} color='#c8c8ff' />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 18, marginTop: 18 }}>
        <Card label='AVG R WIN' value={fmtPct(stats?.avg_r_win_pct ?? 0, 2)} color='#39ff14' />
        <Card label='R / TRADE SOURCE' value={`${stats?.avg_r_by_trade_source || 'n/a'}`} color='#8ab4ff' />
        <Card label='AVG HOLD TIME' value={fmtH(stats?.avg_holding_hours ?? 0, 2)} color='#ffd166' />
        <Card label='HOURS SINCE ATH' value={`${fmtH(stats?.hours_since_last_ath ?? 0, 1)} · ${stats?.last_ath_at ? new Date(stats.last_ath_at).toLocaleDateString() : 'n/a'}`} color='#ffd166' />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 18, marginTop: 18 }}>
        <Card label='WR LONG' value={fmtPct(stats?.win_rate_long_pct ?? 0, 1)} color='#39ff14' />
        <Card label='WR SHORT' value={fmtPct(stats?.win_rate_short_pct ?? 0, 1)} color='#ff6b6b' />
        <Card label='CURRENT STREAK (L/W)' value={`${Number(stats?.current_loss_streak ?? 0)} / ${Number(stats?.current_win_streak ?? 0)}`} color='#ff9f9f' />
        <Card label='CLOSED POSITIONS (window)' value={`${Number(stats?.total_closed_trades ?? 0)}`} color='#c8c8ff' />
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
        <select value={exitMetricView} onChange={(e) => setExitMetricView(e.target.value)} style={{ background: '#1a1a2e', border: '1px solid #2a2a3f', color: '#fff', borderRadius: 8, padding: '6px 10px' }}>
          <option value='coverage'>Exit metric: Exact coverage</option>
          <option value='exact_count'>Exit metric: Exact count</option>
          <option value='proxy_count'>Exit metric: Proxy count</option>
          <option value='other_count'>Exit metric: Other count</option>
          <option value='source'>Exit metric: Source</option>
        </select>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 18, marginTop: 18 }}>
        <Card label='EXIT TP-LIKE' value={`${Number(stats?.exit_tp_like_count ?? 0)}`} color='#39ff14' />
        <Card label='EXIT SL-LIKE' value={`${Number(stats?.exit_sl_like_count ?? 0)}`} color='#ff6b6b' />
        <Card label='EXIT QUALITY' value={`${Number(stats?.exit_exact_coverage_pct ?? 0).toFixed(1)}% / ${Number(stats?.exit_exact_count ?? 0)}`} color={Number(stats?.exit_exact_coverage_pct ?? 0) >= 80 ? '#39ff14' : '#ffd166'} />
        <Card label={exitMetricCard.label} value={exitMetricCard.value} color={exitMetricCard.color} />
      </div>
      </>
      )}

      {showSections.alerts && (
      <div style={panelStyle()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h3 style={{ marginTop: 0, color: '#ffd166', marginBottom: 0 }}>Alerts</h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input type='number' value={alertThresholds.ddPct} onChange={(e) => setAlertThresholds((p) => ({ ...p, ddPct: Number(e.target.value || 0) }))} style={{ width: 80, background: '#1a1a2e', border: '1px solid #2a2a3f', color: '#fff', borderRadius: 8, padding: '6px 8px' }} />
            <input type='number' value={alertThresholds.concentrationPct} onChange={(e) => setAlertThresholds((p) => ({ ...p, concentrationPct: Number(e.target.value || 0) }))} style={{ width: 80, background: '#1a1a2e', border: '1px solid #2a2a3f', color: '#fff', borderRadius: 8, padding: '6px 8px' }} />
            <input type='number' value={alertThresholds.leverageWeighted} onChange={(e) => setAlertThresholds((p) => ({ ...p, leverageWeighted: Number(e.target.value || 0) }))} style={{ width: 80, background: '#1a1a2e', border: '1px solid #2a2a3f', color: '#fff', borderRadius: 8, padding: '6px 8px' }} />
            <input type='number' value={alertThresholds.feeDragPct} onChange={(e) => setAlertThresholds((p) => ({ ...p, feeDragPct: Number(e.target.value || 0) }))} style={{ width: 80, background: '#1a1a2e', border: '1px solid #2a2a3f', color: '#fff', borderRadius: 8, padding: '6px 8px' }} />
          </div>
        </div>
        <p style={{ color: '#8b8ba7', fontSize: 12, marginTop: 6 }}>Thresholds: DD% / Concentration% / Levier pondéré x / Fee drag %</p>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {alerts.map((a, idx) => (
            <li key={idx} style={{ color: a.level === 'OK' ? '#39ff14' : '#ff6b6b', marginBottom: 6 }}>
              <strong>[{a.level}]</strong> {a.msg}
            </li>
          ))}
        </ul>
      </div>
      )}

      {showSections.market && (
      <>
      <div id='sec-market' style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 18, marginTop: 18 }}>
        <Card label='GROSS LONG' value={`$${(risk?.gross_long_usd ?? 0).toFixed?.(2) ?? '0.00'}`} color='#39ff14' />
        <Card label='GROSS SHORT' value={`$${(risk?.gross_short_usd ?? 0).toFixed?.(2) ?? '0.00'}`} color='#ff3131' />
        <Card label='TOP EXPOSURE' value={`${positionSummary.top.symbol} ($${positionSummary.top.notional.toFixed(2)})`} color='#ffd166' />
      </div>


      </>
      )}

      {showSections.tables && (
      <>
      <div id='sec-tables' style={panelStyle()}>
        {staleBySection.tables && <div style={{ color: '#ffd166', fontSize: 12, marginBottom: 8 }}>stale: tables section (last ok before {new Date(staleBySection.tables).toLocaleTimeString()})</div>}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0, color: '#c8c8ff' }}>Trades</h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              value={symbolFilter}
              onChange={(e) => setSymbolFilter(e.target.value)}
              placeholder='Symbol (ex: BTCUSDT)'
              style={{ background: '#1a1a2e', border: '1px solid #2a2a3f', color: '#fff', borderRadius: 8, padding: '8px 10px' }}
            />
            <select value={tradeLimit} onChange={(e) => setTradeLimit(Number(e.target.value))} style={{ background: '#1a1a2e', border: '1px solid #2a2a3f', color: '#fff', borderRadius: 8, padding: '8px 10px' }}>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            <select value={tradeSortBy} onChange={(e) => setTradeSortBy(e.target.value)} style={{ background: '#1a1a2e', border: '1px solid #2a2a3f', color: '#fff', borderRadius: 8, padding: '8px 10px' }}>
              <option value='executed_at'>Sort: time</option>
              <option value='realized_pnl'>Sort: rPnL</option>
              <option value='symbol'>Sort: symbol</option>
            </select>
            <select value={tradeSortDir} onChange={(e) => setTradeSortDir(e.target.value)} style={{ background: '#1a1a2e', border: '1px solid #2a2a3f', color: '#fff', borderRadius: 8, padding: '8px 10px' }}>
              <option value='desc'>Desc</option>
              <option value='asc'>Asc</option>
            </select>
            <button onClick={manualRefreshAll} disabled={manualRefreshLocked} style={{ background: '#00f3ff', color: '#000', border: 'none', borderRadius: 8, padding: '8px 12px', fontWeight: 700, opacity: manualRefreshLocked ? 0.6 : 1 }}>Refresh</button>
            <button onClick={() => exportCsv(csvName('trades', windowFilter), trades)} style={{ background: '#8ab4ff', color: '#000', border: 'none', borderRadius: 8, padding: '8px 12px', fontWeight: 700 }}>Export CSV</button>
          </div>
        </div>

        <div style={{ marginTop: 10, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ color: '#8b8ba7', textAlign: 'left', borderBottom: '1px solid #2a2a3f' }}>
                <th style={{ padding: 8, position: 'sticky', top: 0, background: '#10101a', zIndex: 2 }}>Time</th>
                <th style={{ padding: 8, position: 'sticky', top: 0, left: 0, background: '#10101a', zIndex: 3 }}>Symbol</th>
                <th style={{ padding: 8, position: 'sticky', top: 0, background: '#10101a', zIndex: 2 }}>Side</th>
                <th style={{ padding: 8, position: 'sticky', top: 0, background: '#10101a', zIndex: 2 }}>Price</th>
                <th style={{ padding: 8, position: 'sticky', top: 0, background: '#10101a', zIndex: 2 }}>Qty</th>
                <th style={{ padding: 8, position: 'sticky', top: 0, background: '#10101a', zIndex: 2 }}>Fills</th>
                <th style={{ padding: 8, position: 'sticky', top: 0, background: '#10101a', zIndex: 2 }}>Fee</th>
                <th style={{ padding: 8, position: 'sticky', top: 0, background: '#10101a', zIndex: 2 }}>rPnL</th>
                <th style={{ padding: 8, position: 'sticky', top: 0, background: '#10101a', zIndex: 2 }}>Signal ID</th>
                <th style={{ padding: 8, position: 'sticky', top: 0, background: '#10101a', zIndex: 2 }}>Decision ID</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t, idx) => (
                <tr key={`${t.binance_trade_id}-${t.id}`} style={{ borderBottom: '1px solid #1c1c2b', background: idx % 2 === 0 ? '#0f0f1a' : '#17172a' }} onMouseEnter={(e) => (e.currentTarget.style.background = '#23233a')} onMouseLeave={(e) => (e.currentTarget.style.background = idx % 2 === 0 ? '#0f0f1a' : '#17172a')}>
                  <td style={{ padding: 8 }}>{new Date(t.executed_at).toLocaleString()}</td>
                  <td style={{ padding: 8, position: 'sticky', left: 0, background: '#141426', zIndex: 2, fontWeight: 700 }}>{t.symbol}</td>
                  <td style={{ padding: 8, color: t.side === 'BUY' ? '#39ff14' : '#ff6b6b' }}>{t.side}</td>
                  <td style={{ padding: 8 }}>{Number(t.price).toFixed(4)}</td>
                  <td style={{ padding: 8 }}>{Number(t.qty).toFixed(4)}</td>
                  <td style={{ padding: 8 }}>{t.fills_count ?? 1}</td>
                  <td style={{ padding: 8 }}>{Number(t.commission || 0).toFixed(4)}</td>
                  <td style={{ padding: 8, color: Number(t.realized_pnl) >= 0 ? '#39ff14' : '#ff6b6b' }}>{Number(t.realized_pnl).toFixed(4)}</td>
                  <td style={{ padding: 8, color: '#b7bbd8' }}>{t.signal_id ?? '-'}</td>
                  <td style={{ padding: 8, color: '#b7bbd8' }}>{t.decision_id ?? '-'}</td>
                </tr>
              ))}
              {trades.length === 0 && (
                <tr>
                  <td style={{ padding: 12, color: '#8b8ba7' }} colSpan={10}>No trades for current filters/window.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, color: '#b7bbd8' }}>
          <span>
            Showing {tradeTotal === 0 ? 0 : tradeOffset + 1} - {Math.min(tradeOffset + tradeLimit, tradeTotal)} of {tradeTotal}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => setTradeOffset(Math.max(0, tradeOffset - tradeLimit))}
              disabled={tradeOffset === 0}
              style={{ background: '#1a1a2e', color: '#fff', border: '1px solid #2a2a3f', borderRadius: 8, padding: '6px 10px', opacity: tradeOffset === 0 ? 0.5 : 1 }}
            >
              Prev
            </button>
            <button
              onClick={() => setTradeOffset(tradeOffset + tradeLimit)}
              disabled={tradeOffset + tradeLimit >= tradeTotal}
              style={{ background: '#1a1a2e', color: '#fff', border: '1px solid #2a2a3f', borderRadius: 8, padding: '6px 10px', opacity: tradeOffset + tradeLimit >= tradeTotal ? 0.5 : 1 }}
            >
              Next
            </button>
          </div>
        </div>
      </div>

      <div style={panelStyle()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h3 style={{ marginTop: 0, color: '#c8c8ff', marginBottom: 0 }}>Positions</h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select value={positionSideFilter} onChange={(e) => setPositionSideFilter(e.target.value)} style={{ background: '#1a1a2e', border: '1px solid #2a2a3f', color: '#fff', borderRadius: 8, padding: '8px 10px' }}>
              <option value='ALL'>Side: ALL</option>
              <option value='LONG'>Side: LONG</option>
              <option value='SHORT'>Side: SHORT</option>
            </select>
            <select value={positionSortBy} onChange={(e) => setPositionSortBy(e.target.value)} style={{ background: '#1a1a2e', border: '1px solid #2a2a3f', color: '#fff', borderRadius: 8, padding: '8px 10px' }}>
              <option value='notional_usd'>Sort: notional</option>
              <option value='unrealized_pnl'>Sort: uPnL</option>
              <option value='leverage'>Sort: leverage</option>
              <option value='symbol'>Sort: symbol</option>
            </select>
            <select value={positionSortDir} onChange={(e) => setPositionSortDir(e.target.value)} style={{ background: '#1a1a2e', border: '1px solid #2a2a3f', color: '#fff', borderRadius: 8, padding: '8px 10px' }}>
              <option value='desc'>Desc</option>
              <option value='asc'>Asc</option>
            </select>
            <button onClick={() => exportCsv(csvName('positions', windowFilter), visiblePositions)} style={{ background: '#8ab4ff', color: '#000', border: 'none', borderRadius: 8, padding: '8px 12px', fontWeight: 700 }}>Export CSV</button>
          </div>
        </div>
        <div style={{ marginTop: 10, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ color: '#8b8ba7', textAlign: 'left', borderBottom: '1px solid #2a2a3f' }}>
                <th style={{ padding: 8, position: 'sticky', top: 0, background: '#10101a', zIndex: 2 }}>Symbol</th>
                <th style={{ padding: 8, position: 'sticky', top: 0, background: '#10101a', zIndex: 2 }}>Side</th>
                <th style={{ padding: 8, position: 'sticky', top: 0, background: '#10101a', zIndex: 2 }}>Amount</th>
                <th style={{ padding: 8, position: 'sticky', top: 0, background: '#10101a', zIndex: 2 }}>Entry</th>
                <th style={{ padding: 8, position: 'sticky', top: 0, background: '#10101a', zIndex: 2 }}>Mark</th>
                <th style={{ padding: 8, position: 'sticky', top: 0, background: '#10101a', zIndex: 2 }}>Notional</th>
                <th style={{ padding: 8, position: 'sticky', top: 0, background: '#10101a', zIndex: 2 }}>Leverage</th>
                <th style={{ padding: 8, position: 'sticky', top: 0, background: '#10101a', zIndex: 2 }}>uPnL</th>
              </tr>
            </thead>
            <tbody>
              {visiblePositions.map((p, idx) => {
                const isTop = p.symbol === positionSummary.top.symbol
                return (
                  <tr key={`${p.symbol}-${p.id}`} style={{ borderBottom: '1px solid #1c1c2b', background: isTop ? '#2b2414' : (idx % 2 === 0 ? '#0f0f1a' : '#17172a') }} onMouseEnter={(e) => (e.currentTarget.style.background = isTop ? '#3a2f18' : '#23233a')} onMouseLeave={(e) => (e.currentTarget.style.background = isTop ? '#2b2414' : (idx % 2 === 0 ? '#0f0f1a' : '#17172a'))}>
                    <td style={{ padding: 8, position: 'sticky', left: 0, background: isTop ? '#2b2414' : '#141426', zIndex: 2, fontWeight: 700 }}>{p.symbol}{isTop ? ' ⭐' : ''}</td>
                    <td style={{ padding: 8, color: p.side === 'LONG' ? '#39ff14' : '#ff6b6b' }}>{p.side}</td>
                    <td style={{ padding: 8 }}>{Number(p.position_amt).toFixed(4)}</td>
                    <td style={{ padding: 8 }}>{Number(p.entry_price).toFixed(4)}</td>
                    <td style={{ padding: 8 }}>{Number(p.mark_price).toFixed(4)}</td>
                    <td style={{ padding: 8 }}>${Number(p.notional_usd).toFixed(2)}</td>
                    <td style={{ padding: 8 }}>{p.leverage}x</td>
                    <td style={{ padding: 8, color: Number(p.unrealized_pnl) >= 0 ? '#39ff14' : '#ff6b6b' }}>${Number(p.unrealized_pnl).toFixed(2)}</td>
                  </tr>
                )
              })}
              {visiblePositions.length === 0 && (
                <tr>
                  <td style={{ padding: 12, color: '#8b8ba7' }} colSpan={8}>No open positions matching current filters.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div style={panelStyle()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h3 style={{ marginTop: 0, color: '#c8c8ff', marginBottom: 0 }}>Last sync events</h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              value={syncEventsFilterEndpoint}
              onChange={(e) => {
                setSyncEventsMeta((p) => ({ ...p, offset: 0 }))
                setSyncEventsFilterEndpoint(e.target.value)
              }}
              placeholder='Filter endpoint (ex: sync/all)'
              style={{ background: '#1a1a2e', border: '1px solid #2a2a3f', color: '#fff', borderRadius: 8, padding: '8px 10px' }}
            />
            <select
              value={syncEventsFilterStatus}
              onChange={(e) => {
                setSyncEventsMeta((p) => ({ ...p, offset: 0 }))
                setSyncEventsFilterStatus(e.target.value)
              }}
              style={{ background: '#1a1a2e', border: '1px solid #2a2a3f', color: '#fff', borderRadius: 8, padding: '8px 10px' }}
            >
              <option value=''>Status: all</option>
              <option value='ok'>Status: ok</option>
              <option value='error'>Status: error</option>
            </select>
            <select
              value={syncEventsMeta.limit}
              onChange={(e) => setSyncEventsMeta((p) => ({ ...p, limit: Number(e.target.value), offset: 0 }))}
              style={{ background: '#1a1a2e', border: '1px solid #2a2a3f', color: '#fff', borderRadius: 8, padding: '8px 10px' }}
            >
              <option value={8}>Rows 8</option>
              <option value={20}>Rows 20</option>
              <option value={50}>Rows 50</option>
            </select>
            <button onClick={() => window.open(`${API_URL}/sync/events.csv?${new URLSearchParams({ endpoint: syncEventsFilterEndpoint || '', status: syncEventsFilterStatus || '' }).toString()}`, '_blank')} style={{ background: '#8ab4ff', color: '#000', border: 'none', borderRadius: 8, padding: '8px 12px', fontWeight: 700 }}>
              Export events CSV
            </button>
          </div>
        </div>
        <div style={{ overflowX: 'auto', marginTop: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ color: '#8b8ba7', textAlign: 'left', borderBottom: '1px solid #2a2a3f' }}>
                <th style={{ padding: 8, position: 'sticky', top: 0, background: '#10101a', zIndex: 2 }}>Time</th>
                <th style={{ padding: 8, position: 'sticky', top: 0, background: '#10101a', zIndex: 2 }}>Endpoint</th>
                <th style={{ padding: 8, position: 'sticky', top: 0, background: '#10101a', zIndex: 2 }}>Status</th>
                <th style={{ padding: 8, position: 'sticky', top: 0, background: '#10101a', zIndex: 2 }}>Actor</th>
                <th style={{ padding: 8, position: 'sticky', top: 0, background: '#10101a', zIndex: 2 }}>Symbol</th>
                <th style={{ padding: 8, position: 'sticky', top: 0, background: '#10101a', zIndex: 2 }}>Duration</th>
                <th style={{ padding: 8, position: 'sticky', top: 0, background: '#10101a', zIndex: 2 }}>Detail</th>
              </tr>
            </thead>
            <tbody>
              {syncEvents.map((e, idx) => (
                <tr key={e.id} style={{ borderBottom: '1px solid #1c1c2b', background: idx % 2 === 0 ? 'transparent' : '#121223' }}>
                  <td style={{ padding: 8 }}>{e.created_at ? new Date(e.created_at).toLocaleString() : '-'}</td>
                  <td style={{ padding: 8 }}>{e.endpoint}</td>
                  <td style={{ padding: 8, color: e.status === 'ok' ? '#39ff14' : '#ff6b6b' }}>{e.status}</td>
                  <td style={{ padding: 8 }}>{e.actor || '-'}</td>
                  <td style={{ padding: 8 }}>{e.symbol || '-'}</td>
                  <td style={{ padding: 8 }}>{e.duration_ms ?? '-'} ms</td>
                  <td style={{ padding: 8, color: '#b7bbd8' }}>{e.detail || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, color: '#b7bbd8' }}>
          <span>
            Showing {syncEventsMeta.total === 0 ? 0 : syncEventsMeta.offset + 1} - {Math.min(syncEventsMeta.offset + syncEventsMeta.limit, syncEventsMeta.total)} of {syncEventsMeta.total}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => setSyncEventsMeta((p) => ({ ...p, offset: Math.max(0, p.offset - p.limit) }))}
              disabled={syncEventsMeta.offset === 0}
              style={{ background: '#1a1a2e', color: '#fff', border: '1px solid #2a2a3f', borderRadius: 8, padding: '6px 10px', opacity: syncEventsMeta.offset === 0 ? 0.5 : 1 }}
            >
              Prev
            </button>
            <button
              onClick={() => setSyncEventsMeta((p) => ({ ...p, offset: p.offset + p.limit }))}
              disabled={syncEventsMeta.offset + syncEventsMeta.limit >= syncEventsMeta.total}
              style={{ background: '#1a1a2e', color: '#fff', border: '1px solid #2a2a3f', borderRadius: 8, padding: '6px 10px', opacity: syncEventsMeta.offset + syncEventsMeta.limit >= syncEventsMeta.total ? 0.5 : 1 }}
            >
              Next
            </button>
            <button onClick={manualRefreshAll} disabled={manualRefreshLocked} style={{ background: '#00f3ff', color: '#000', border: 'none', borderRadius: 8, padding: '6px 10px', fontWeight: 700, opacity: manualRefreshLocked ? 0.6 : 1 }}>Refresh</button>
          </div>
        </div>
      </div>

      <div style={panelStyle()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h3 style={{ marginTop: 0, color: '#c8c8ff', marginBottom: 0 }}>Audit summary ({windowFilter})</h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select value={auditTradesMeta.limit} onChange={(e) => setAuditTradesMeta((p) => ({ ...p, limit: Number(e.target.value), offset: 0 }))} style={{ background: '#1a1a2e', border: '1px solid #2a2a3f', color: '#fff', borderRadius: 8, padding: '8px 10px' }}>
              <option value={25}>Page 25</option>
              <option value={50}>Page 50</option>
              <option value={100}>Page 100</option>
            </select>
            <button onClick={() => window.open(`${API_URL}/audit/trades.csv?window=${windowFilter}`, '_blank')} style={{ background: '#8ab4ff', color: '#000', border: 'none', borderRadius: 8, padding: '8px 12px', fontWeight: 700 }}>Export audit CSV (backend)</button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', color: '#cfd3ff', marginTop: 10 }}>
          <span>Trades: <strong>{audit?.trades_count ?? 0}</strong></span>
          <span>Realized PnL: <strong>{audit?.total_realized_pnl ?? 0}</strong></span>
          <span>Fees: <strong>{audit?.total_fees ?? 0}</strong></span>
          <span>Global checksum: <strong style={{ fontFamily: 'monospace' }}>{(audit?.checksum_sha256 || 'n/a').slice(0, 16)}...</strong></span>
          <span>Page checksum: <strong style={{ fontFamily: 'monospace' }}>{(auditTradesMeta?.checksum || 'n/a').slice(0, 16)}...</strong></span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, color: '#b7bbd8' }}>
          <span>
            Page {auditTradesMeta.total === 0 ? 0 : Math.floor(auditTradesMeta.offset / auditTradesMeta.limit) + 1} / {Math.max(1, Math.ceil((auditTradesMeta.total || 0) / auditTradesMeta.limit))}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => setAuditTradesMeta((p) => ({ ...p, offset: Math.max(0, p.offset - p.limit) }))}
              disabled={auditTradesMeta.offset === 0}
              style={{ background: '#1a1a2e', color: '#fff', border: '1px solid #2a2a3f', borderRadius: 8, padding: '6px 10px', opacity: auditTradesMeta.offset === 0 ? 0.5 : 1 }}
            >
              Prev
            </button>
            <button
              onClick={() => setAuditTradesMeta((p) => ({ ...p, offset: p.offset + p.limit }))}
              disabled={auditTradesMeta.offset + auditTradesMeta.limit >= auditTradesMeta.total}
              style={{ background: '#1a1a2e', color: '#fff', border: '1px solid #2a2a3f', borderRadius: 8, padding: '6px 10px', opacity: auditTradesMeta.offset + auditTradesMeta.limit >= auditTradesMeta.total ? 0.5 : 1 }}
            >
              Next
            </button>
            <button onClick={manualRefreshAll} disabled={manualRefreshLocked} style={{ background: '#00f3ff', color: '#000', border: 'none', borderRadius: 8, padding: '6px 10px', fontWeight: 700, opacity: manualRefreshLocked ? 0.6 : 1 }}>Refresh page checksum</button>
          </div>
        </div>
      </div>
      </>
      )}

      <div id='sec-ops' style={{ ...panelStyle(), marginTop: 24, border: '1px solid #2f2f45' }}>
        <h3 style={{ marginTop: 0, color: '#c8c8ff' }}>Ops & Debug (moved down)</h3>
        {staleBySection.ops && <div style={{ color: '#ffd166', fontSize: 12, marginBottom: 8 }}>stale: ops section (last ok before {new Date(staleBySection.ops).toLocaleTimeString()})</div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <Card label='BOT STATUS' value={(runtimeHealth?.bot_status || 'unknown').toUpperCase()} color={runtimeHealth?.bot_status === 'running' ? '#39ff14' : runtimeHealth?.bot_status === 'degraded' ? '#ffd166' : '#ff6b6b'} />
          <Card label='HB AGE' value={runtimeHealth?.heartbeat_age_sec == null ? 'n/a' : `${runtimeHealth.heartbeat_age_sec}s`} color='#8ab4ff' />
          <Card label='EXEC ERRORS (1h)' value={execSummary?.error_events_1h ?? 0} color={Number(execSummary?.error_events_1h ?? 0) > 0 ? '#ff6b6b' : '#39ff14'} />
          <Card label='AVG EXEC LATENCY' value={execSummary?.avg_latency_ms == null ? 'n/a' : fmtLatency(execSummary.avg_latency_ms)} color='#c8c8ff' />
        </div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', color: '#b7bbd8', marginTop: 10, fontSize: 13 }}>
          <span>Last sync: <strong>{diag?.sync?.last_sync_at ? new Date(diag.sync.last_sync_at).toLocaleString() : 'n/a'}</strong></span>
          <span>DB latency: <strong>{diag?.db?.latency_ms ?? 'n/a'} ms</strong></span>
          <span>Min sync interval: <strong>{diag?.sync?.min_interval_seconds ?? 'n/a'}s</strong></span>
          <span>Heartbeat source: <strong>{runtimeHealth?.last_heartbeat_source || 'n/a'}</strong></span>
          <span>Heartbeat status: <strong>{runtimeHealth?.last_heartbeat_status || 'n/a'}</strong></span>
          <span>P50/P95: <strong>{execSummary?.p50_latency_ms ?? 'n/a'} / {execSummary?.p95_latency_ms ?? 'n/a'} ms</strong></span>
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 10, color: '#b7bbd8', fontSize: 13 }}>
          <span>Data quality:</span>
          <span>R loss <strong>{stats?.data_quality?.avg_r_loss || 'n/a'}</strong></span>
          <span>R by trade <strong>{stats?.data_quality?.avg_r_by_trade || 'n/a'}</strong></span>
          <span>Exit dist <strong>{stats?.data_quality?.exit_distribution || 'n/a'}</strong></span>
          <span>Funding <strong>{stats?.data_quality?.funding_fees || 'n/a'}</strong></span>
          <span>Integration mode <strong>{Number(stats?.exit_exact_coverage_pct ?? 0) > 0 ? 'API + Bot events (partial exact)' : 'API-only'}</strong></span>
        </div>

        <div style={{ marginTop: 8, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={testBotHeartbeat} style={{ background: '#8ab4ff', color: '#000', border: 'none', borderRadius: 8, padding: '6px 10px', fontWeight: 700 }}>
            Test bot heartbeat
          </button>
          <button onClick={testExecutionIngest} style={{ background: '#ffd166', color: '#000', border: 'none', borderRadius: 8, padding: '6px 10px', fontWeight: 700 }}>
            Test execution ingest
          </button>
          {heartbeatTestMsg && <span style={{ color: heartbeatTestMsg.includes('OK') ? '#39ff14' : '#ff6b6b', fontSize: 13 }}>{heartbeatTestMsg}</span>}
          {execIngestTestMsg && <span style={{ color: execIngestTestMsg.includes('OK') ? '#39ff14' : '#ff6b6b', fontSize: 13 }}>{execIngestTestMsg}</span>}
        </div>

        <div style={{ marginTop: 8, display: 'flex', gap: 16, flexWrap: 'wrap', color: '#b7bbd8', fontSize: 13 }}>
          <span>Integration status:</span>
          <span>Heartbeat <strong style={{ color: integrationStatus.heartbeatOk == null ? '#c8c8ff' : (integrationStatus.heartbeatOk ? '#39ff14' : '#ff6b6b') }}>{integrationStatus.heartbeatOk == null ? 'n/a' : (integrationStatus.heartbeatOk ? 'OK' : 'FAIL')}</strong></span>
          <span>Execution ingest <strong style={{ color: integrationStatus.executionOk == null ? '#c8c8ff' : (integrationStatus.executionOk ? '#39ff14' : '#ff6b6b') }}>{integrationStatus.executionOk == null ? 'n/a' : (integrationStatus.executionOk ? 'OK' : 'FAIL')}</strong></span>
          <span>Last test <strong>{integrationStatus.lastTestAt ? new Date(integrationStatus.lastTestAt).toLocaleTimeString() : 'n/a'}</strong></span>
        </div>
      </div>
    </div>
  )
}

export default Dashboard
