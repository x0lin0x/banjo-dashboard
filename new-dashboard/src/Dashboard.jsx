import { useEffect, useMemo, useState } from 'react'
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
    <div style={{ background: '#1a1a2e', border: `1px solid ${color}`, padding: 20, borderRadius: 12, boxShadow: `0 0 16px ${color}33` }}>
      <p style={{ color: '#888', marginBottom: 8 }}>{label}</p>
      <p style={{ fontSize: 28, fontWeight: 'bold', color, margin: 0 }}>{value}</p>
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

function Dashboard() {
  const saved = loadSettings()

  const [stats, setStats] = useState(null)
  const [risk, setRisk] = useState(null)
  const [equity, setEquity] = useState([])
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
  const [auditTradesMeta, setAuditTradesMeta] = useState({ total: 0, limit: 25, offset: 0, checksum: '' })
  const [syncEvents, setSyncEvents] = useState([])
  const [syncEventsMeta, setSyncEventsMeta] = useState({ total: 0, limit: 8, offset: 0 })
  const [syncEventsFilterEndpoint, setSyncEventsFilterEndpoint] = useState('')
  const [syncEventsFilterStatus, setSyncEventsFilterStatus] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState('')
  const [syncErrorStreak, setSyncErrorStreak] = useState(0)
  const [autoSyncCooldownUntil, setAutoSyncCooldownUntil] = useState(null)

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
  const [tradeLimit, setTradeLimit] = useState(saved.tradeLimit || 25)
  const [tradeOffset, setTradeOffset] = useState(0)
  const [tradeTotal, setTradeTotal] = useState(0)
  const [tradeSortBy, setTradeSortBy] = useState(saved.tradeSortBy || 'executed_at')
  const [tradeSortDir, setTradeSortDir] = useState(saved.tradeSortDir || 'desc')

  const [positionSideFilter, setPositionSideFilter] = useState(saved.positionSideFilter || 'ALL')
  const [positionSortBy, setPositionSortBy] = useState(saved.positionSortBy || 'notional_usd')
  const [positionSortDir, setPositionSortDir] = useState(saved.positionSortDir || 'desc')

  const loadBase = () => {
    Promise.all([
      fetch(`${API_URL}/stats/overview?window=${windowFilter}`).then((r) => r.json()),
      fetch(`${API_URL}/risk/exposure`).then((r) => r.json()),
      fetch(`${API_URL}/stats/equity?window=${windowFilter}`).then((r) => r.json()),
      fetch(`${API_URL}/positions`).then((r) => r.json()),
      fetch(`${API_URL}/diagnostics/connectors`).then((r) => r.json()),
      fetch(`${API_URL}/health/runtime`).then((r) => r.json()),
      fetch(`${API_URL}/diagnostics/db-writable`).then((r) => r.json()),
      fetch(`${API_URL}/execution/summary?window=${windowFilter}`).then((r) => r.json()),
      fetch(`${API_URL}/audit/summary?window=${windowFilter}`).then((r) => r.json())
    ])
      .then(([overview, riskRes, equityRes, positionsRes, diagRes, runtimeRes, dbWritableRes, execRes, auditRes]) => {
        setStats(overview)
        setRisk(riskRes)
        setEquity(equityRes?.points || [])
        setPositions(positionsRes?.positions || [])
        setDiag(diagRes)
        setRuntimeHealth(runtimeRes)
        setDbWritable(dbWritableRes)
        setExecSummary(execRes)
        setAudit(auditRes)
      })
      .catch(() => {
        setStats(null)
        setRisk(null)
        setEquity([])
        setPositions([])
        setDiag(null)
        setRuntimeHealth(null)
        setDbWritable(null)
        setExecSummary(null)
        setAudit(null)
      })
  }

  const loadAuditTradesMeta = () => {
    const params = new URLSearchParams({
      window: windowFilter,
      limit: String(auditTradesMeta.limit),
      offset: String(auditTradesMeta.offset)
    })

    fetch(`${API_URL}/audit/trades?${params.toString()}`)
      .then((r) => r.json())
      .then((res) => {
        setAuditTradesMeta((p) => ({
          ...p,
          total: res?.total || 0,
          checksum: res?.page_checksum_sha256 || ''
        }))
      })
      .catch(() => {
        setAuditTradesMeta((p) => ({ ...p, total: 0, checksum: '' }))
      })
  }

  const loadExecutionEvents = () => {
    const params = new URLSearchParams({ limit: '8', offset: '0' })
    if (execStatusFilter) params.append('status', execStatusFilter)

    fetch(`${API_URL}/execution/events?${params.toString()}`)
      .then((r) => r.json())
      .then((res) => {
        setExecEvents(res?.events || [])
      })
      .catch(() => {
        setExecEvents([])
      })
  }

  const loadExecutionErrorsSeries = () => {
    fetch(`${API_URL}/execution/errors-timeseries?window=${windowFilter}`)
      .then((r) => r.json())
      .then((res) => {
        setExecErrorsSeries(res?.points || [])
      })
      .catch(() => {
        setExecErrorsSeries([])
      })
  }

  const loadSyncEvents = () => {
    const params = new URLSearchParams({
      limit: String(syncEventsMeta.limit),
      offset: String(syncEventsMeta.offset)
    })
    if (syncEventsFilterEndpoint.trim()) params.append('endpoint', syncEventsFilterEndpoint.trim())
    if (syncEventsFilterStatus.trim()) params.append('status', syncEventsFilterStatus.trim())

    fetch(`${API_URL}/sync/events?${params.toString()}`)
      .then((r) => r.json())
      .then((res) => {
        setSyncEvents(res?.events || [])
        setSyncEventsMeta((p) => ({ ...p, total: res?.total || 0 }))
      })
      .catch(() => {
        setSyncEvents([])
        setSyncEventsMeta((p) => ({ ...p, total: 0 }))
      })
  }

  const loadTrades = () => {
    const params = new URLSearchParams({
      limit: String(tradeLimit),
      offset: String(tradeOffset),
      window: windowFilter,
      sort_by: tradeSortBy,
      sort_dir: tradeSortDir
    })
    if (symbolFilter.trim()) params.append('symbol', symbolFilter.trim().toUpperCase())

    fetch(`${API_URL}/trades?${params.toString()}`)
      .then((r) => r.json())
      .then((res) => {
        setTrades(res?.trades || [])
        setTradeTotal(res?.total || 0)
      })
      .catch(() => {
        setTrades([])
        setTradeTotal(0)
      })
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

      const res = await fetch(`${API_URL}/sync/scan-all-symbols?limit=80&lookback_days=7&max_recent_symbols=8&per_symbol_delay_ms=350`, { method: 'POST', headers, signal: controller.signal })

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        throw new Error(payload?.detail || `Sync failed (${res.status})`)
      }
      setSyncErrorStreak(0)
      setAutoSyncCooldownUntil(null)
      loadBase()
      loadTrades()
      loadAuditTradesMeta()
      loadSyncEvents()
      loadExecutionEvents()
      loadExecutionErrorsSeries()
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
    loadBase()
    loadTrades()
    loadAuditTradesMeta()
    loadSyncEvents()
    loadExecutionEvents()
    loadExecutionErrorsSeries()
  }, [windowFilter])

  useEffect(() => {
    setTradeOffset(0)
  }, [symbolFilter, tradeLimit, windowFilter, tradeSortBy, tradeSortDir])

  useEffect(() => {
    loadTrades()
  }, [symbolFilter, tradeLimit, tradeOffset, windowFilter, tradeSortBy, tradeSortDir])

  useEffect(() => {
    loadAuditTradesMeta()
  }, [windowFilter, auditTradesMeta.limit, auditTradesMeta.offset])

  useEffect(() => {
    loadSyncEvents()
  }, [syncEventsMeta.limit, syncEventsMeta.offset, syncEventsFilterEndpoint, syncEventsFilterStatus])

  useEffect(() => {
    loadExecutionEvents()
  }, [execStatusFilter])

  useEffect(() => {
    if (refreshSec === 'off') return undefined
    const ms = Number(refreshSec) * 1000
    const id = setInterval(() => {
      loadBase()
      loadTrades()
      loadAuditTradesMeta()
      loadSyncEvents()
      loadExecutionEvents()
      loadExecutionErrorsSeries()
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
      quickMode,
      opsIncidentLog
    }
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(payload))
  }, [windowFilter, refreshSec, alertThresholds, symbolFilter, tradeLimit, tradeSortBy, tradeSortDir, positionSideFilter, positionSortBy, positionSortDir, syncToken, autoSyncSec, showSections, defaultPreset, quickMode, opsIncidentLog])

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

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0f', color: 'white', padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ color: '#b026ff', textShadow: '0 0 10px #b026ff', marginTop: 0, marginBottom: 0 }}>⚡ BANJO TRADING DASHBOARD</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Badge ok={diag?.db?.status === 'ok'} label={`DB: ${diag?.db?.status || 'unknown'}`} />
          <Badge ok={diag?.binance?.status === 'configured'} label={`BINANCE: ${diag?.binance?.status || 'unknown'}`} />
          <Badge ok={diag?.sync?.role === 'operator'} label={`ROLE: ${(diag?.sync?.role || 'operator').toUpperCase()}`} />
          <Badge ok={!diag?.sync?.read_only} label={diag?.sync?.read_only ? 'MODE: READ-ONLY' : 'MODE: ACTIVE'} />
          <select value={windowFilter} onChange={(e) => setWindowFilter(e.target.value)} style={{ background: '#1a1a2e', border: '1px solid #2a2a3f', color: '#fff', borderRadius: 8, padding: '8px 10px' }}>
            <option value='24h'>24h</option>
            <option value='7d'>7d</option>
            <option value='30d'>30d</option>
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
        <span style={{ marginLeft: 8 }}>Custom:</span>
        {Object.entries(showSections).map(([k, v]) => (
          <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type='checkbox' checked={!!v} onChange={(e) => setShowSections((p) => ({ ...p, [k]: e.target.checked }))} />
            {k}
          </label>
        ))}
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 18, marginTop: 18 }}>
            <Card label='BOT STATUS' value={(runtimeHealth?.bot_status || 'unknown').toUpperCase()} color={runtimeHealth?.bot_status === 'running' ? '#39ff14' : runtimeHealth?.bot_status === 'degraded' ? '#ffd166' : '#ff6b6b'} />
            <Card label='HB AGE' value={runtimeHealth?.heartbeat_age_sec == null ? 'n/a' : `${runtimeHealth.heartbeat_age_sec}s`} color='#8ab4ff' />
            <Card label='OPEN POSITIONS' value={runtimeHealth?.open_positions_count ?? 0} color='#b026ff' />
            <Card label='API ERRORS (24h)' value={runtimeHealth?.api_errors_24h ?? 0} color={Number(runtimeHealth?.api_errors_24h ?? 0) > 0 ? '#ff6b6b' : '#39ff14'} />
          </div>

          <div style={panelStyle()}>
            <h3 style={{ marginTop: 0, color: '#c8c8ff' }}>Runtime diagnostics</h3>
            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', color: '#cfd3ff' }}>
              <span>Last sync: <strong>{diag?.sync?.last_sync_at ? new Date(diag.sync.last_sync_at).toLocaleString() : 'n/a'}</strong></span>
              <span>DB latency: <strong>{diag?.db?.latency_ms ?? 'n/a'} ms</strong></span>
              <span>Server time: <strong>{diag?.sync?.server_time ? new Date(diag.sync.server_time).toLocaleString() : 'n/a'}</strong></span>
              <span>Min sync interval: <strong>{diag?.sync?.min_interval_seconds ?? 'n/a'}s</strong></span>
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
          </div>
        </>
      )}

      {showSections.execution && (
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
                <th style={{ padding: 8 }}>Time</th>
                <th style={{ padding: 8 }}>Type</th>
                <th style={{ padding: 8 }}>Status</th>
                <th style={{ padding: 8 }}>Symbol</th>
                <th style={{ padding: 8 }}>Latency</th>
                <th style={{ padding: 8 }}>Error</th>
              </tr>
            </thead>
            <tbody>
              {execEvents.map((e) => (
                <tr key={e.id} style={{ borderBottom: '1px solid #1c1c2b' }}>
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
      <div style={panelStyle()}>
        <h3 style={{ marginTop: 0, color: '#ffd166' }}>Risk strip</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <Card label='CURRENT DD' value={`${Number(stats?.current_drawdown_pct ?? 0).toFixed(2)}%`} color={Number(stats?.current_drawdown_pct ?? 0) > 0 ? '#ff6b6b' : '#39ff14'} />
          <Card label='MAX DD' value={`${Number(stats?.max_drawdown_pct ?? 0).toFixed(2)}%`} color='#ff9f9f' />
          <Card label='DD DURATION (max/current)' value={`${Number(stats?.max_dd_duration_hours ?? 0).toFixed(1)}h / ${Number(stats?.current_dd_duration_hours ?? 0).toFixed(1)}h`} color='#ffd166' />
          <Card label='LOSS STREAK (max/current)' value={`${Number(stats?.max_consecutive_losses ?? 0)} / ${Number(stats?.current_loss_streak ?? 0)}`} color='#ff9f9f' />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 18, marginTop: 24 }}>
        <Card label='POSITIONS' value={stats?.total_positions ?? 0} color='#b026ff' />
        <Card label='CLOSED POSITIONS' value={stats?.total_closed_trades ?? stats?.total_trades ?? 0} color='#00f3ff' />
        <Card label='REALIZED P&L' value={`$${(stats?.total_realized_pnl ?? 0).toFixed?.(2) ?? '0.00'}`} color={(stats?.total_realized_pnl ?? 0) >= 0 ? '#39ff14' : '#ff3131'} />
        <Card label='UNREALIZED P&L' value={`$${(stats?.total_unrealized_pnl ?? 0).toFixed?.(2) ?? '0.00'}`} color={(stats?.total_unrealized_pnl ?? 0) >= 0 ? '#39ff14' : '#ff3131'} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 18, marginTop: 18 }}>
        <Card label='NET P&L AFTER FEES' value={`$${Number(stats?.net_pnl_after_fees ?? 0).toFixed(2)}`} color={Number(stats?.net_pnl_after_fees ?? 0) >= 0 ? '#39ff14' : '#ff6b6b'} />
        <Card label='PROFIT FACTOR' value={stats?.profit_factor == null ? 'n/a' : Number(stats.profit_factor).toFixed(2)} color='#8ab4ff' />
        <Card label='EXPECTANCY' value={`$${Number(stats?.expectancy ?? 0).toFixed(2)}`} color={Number(stats?.expectancy ?? 0) >= 0 ? '#39ff14' : '#ff6b6b'} />
        <Card label='AVG WIN/LOSS' value={stats?.avg_win_loss_ratio == null ? 'n/a' : Number(stats.avg_win_loss_ratio).toFixed(2)} color='#ffd166' />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 18, marginTop: 18 }}>
        <Card label='TRADING FEES (window)' value={`$${Number(stats?.total_fees_window ?? 0).toFixed(2)}`} color='#ff9f9f' />
        <Card label='FUNDING FEES (window)' value={stats?.funding_fees_cumulative == null ? 'n/a' : `$${Number(stats?.funding_fees_cumulative).toFixed(2)}`} color='#c8c8ff' />
        <Card label='FEE DRAG %' value={stats?.fee_drag_pct == null ? 'n/a' : `${Number(stats.fee_drag_pct).toFixed(2)}%`} color='#ff9f9f' />
        <Card label='FUNDING SHARE %' value={stats?.funding_share_pct == null ? 'n/a' : `${Number(stats.funding_share_pct).toFixed(2)}%`} color='#8ab4ff' />
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
                <th style={{ padding: 8 }}>Symbol</th>
                <th style={{ padding: 8 }}>Funding fee</th>
                <th style={{ padding: 8 }}>Abs</th>
              </tr>
            </thead>
            <tbody>
              {(stats?.top_funding_symbols || []).map((row) => (
                <tr key={row.symbol} style={{ borderBottom: '1px solid #1c1c2b' }}>
                  <td style={{ padding: 8 }}>{row.symbol}</td>
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
        <Card label='MARGIN USED' value={`$${Number(stats?.margin_used_positions ?? 0).toFixed(2)}`} color='#ffd166' />
        <Card label='MAX DD (window)' value={`${stats?.max_drawdown_pct ?? 0}%`} color={ddColor} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 18, marginTop: 18 }}>
        <Card label='LAST ATH (proxy)' value={stats?.last_ath_balance == null ? 'n/a' : `$${Number(stats.last_ath_balance).toFixed(2)}`} color='#ffd166' />
        <Card label='AVG R LOSS' value={`${Number(stats?.avg_r_loss_pct ?? 0).toFixed(2)}%`} color='#ff6b6b' />
        <Card label='AVG LOSS $ (closed pos)' value={`$${Number(stats?.avg_r_loss_usd ?? 0).toFixed(2)}`} color='#ff9f9f' />
        <Card label='R LOSS SOURCE' value={`${stats?.avg_r_loss_source || 'n/a'} (${stats?.avg_r_loss_verified_samples ?? 0})`} color='#c8c8ff' />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 18, marginTop: 18 }}>
        <Card label='AVG R WIN' value={`${Number(stats?.avg_r_win_pct ?? 0).toFixed(2)}%`} color='#39ff14' />
        <Card label='AVG R BY TRADE' value={`${Number(stats?.avg_r_by_trade_pct ?? 0).toFixed(2)}R`} color={Number(stats?.avg_r_by_trade_pct ?? 0) >= 0 ? '#39ff14' : '#ff6b6b'} />
        <Card label='R BY TRADE SOURCE' value={`${stats?.avg_r_by_trade_source || 'n/a'}`} color='#8ab4ff' />
        <Card label='CLOSED POSITIONS (window)' value={`${Number(stats?.total_closed_trades ?? 0)}`} color='#c8c8ff' />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 18, marginTop: 18 }}>
        <Card label='WIN RATE LONG' value={`${Number(stats?.win_rate_long_pct ?? 0).toFixed(1)}%`} color='#39ff14' />
        <Card label='WIN RATE SHORT' value={`${Number(stats?.win_rate_short_pct ?? 0).toFixed(1)}%`} color='#ff6b6b' />
        <Card label='AVG HOLDING TIME' value={`${Number(stats?.avg_holding_hours ?? 0).toFixed(2)}h`} color='#ffd166' />
        <Card label='CURRENT STREAK (L/W)' value={`${Number(stats?.current_loss_streak ?? 0)} / ${Number(stats?.current_win_streak ?? 0)}`} color='#ff9f9f' />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 18, marginTop: 18 }}>
        <Card label='EXIT TP-LIKE' value={`${Number(stats?.exit_tp_like_count ?? 0)}`} color='#39ff14' />
        <Card label='EXIT SL-LIKE' value={`${Number(stats?.exit_sl_like_count ?? 0)}`} color='#ff6b6b' />
        <Card label='EXIT OTHER' value={`${Number(stats?.exit_other_count ?? 0)}`} color='#ffd166' />
        <Card label='EXIT SOURCE' value={`${stats?.exit_reason_source || 'n/a'}`} color='#8ab4ff' />
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 18, marginTop: 18 }}>
        <Card label='GROSS LONG' value={`$${(risk?.gross_long_usd ?? 0).toFixed?.(2) ?? '0.00'}`} color='#39ff14' />
        <Card label='GROSS SHORT' value={`$${(risk?.gross_short_usd ?? 0).toFixed?.(2) ?? '0.00'}`} color='#ff3131' />
        <Card label='TOP EXPOSURE' value={`${positionSummary.top.symbol} ($${positionSummary.top.notional.toFixed(2)})`} color='#ffd166' />
      </div>

      <div style={panelStyle()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h3 style={{ marginTop: 0, color: '#c8c8ff', marginBottom: 0 }}>Equity trend ({windowFilter} realized cumulative)</h3>
          <button onClick={() => exportCsv('equity.csv', equity)} style={{ background: '#8ab4ff', color: '#000', border: 'none', borderRadius: 8, padding: '8px 12px', fontWeight: 700 }}>Export CSV</button>
        </div>
        <div style={{ width: '100%', height: 260 }}>
          <ResponsiveContainer>
            <LineChart data={equity}>
              <XAxis dataKey='ts' tick={{ fill: '#888' }} />
              <YAxis tick={{ fill: '#888' }} />
              <Tooltip />
              <Line type='monotone' dataKey='equity' stroke='#00f3ff' strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      </>
      )}

      {showSections.tables && (
      <>
      <div style={panelStyle()}>
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
            <button onClick={loadTrades} style={{ background: '#00f3ff', color: '#000', border: 'none', borderRadius: 8, padding: '8px 12px', fontWeight: 700 }}>Refresh</button>
            <button onClick={() => exportCsv('trades.csv', trades)} style={{ background: '#8ab4ff', color: '#000', border: 'none', borderRadius: 8, padding: '8px 12px', fontWeight: 700 }}>Export CSV</button>
          </div>
        </div>

        <div style={{ marginTop: 10, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ color: '#8b8ba7', textAlign: 'left', borderBottom: '1px solid #2a2a3f' }}>
                <th style={{ padding: 8 }}>Time</th>
                <th style={{ padding: 8 }}>Symbol</th>
                <th style={{ padding: 8 }}>Side</th>
                <th style={{ padding: 8 }}>Price</th>
                <th style={{ padding: 8 }}>Qty</th>
                <th style={{ padding: 8 }}>Fills</th>
                <th style={{ padding: 8 }}>Fee</th>
                <th style={{ padding: 8 }}>rPnL</th>
                <th style={{ padding: 8 }}>Signal ID</th>
                <th style={{ padding: 8 }}>Decision ID</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => (
                <tr key={`${t.binance_trade_id}-${t.id}`} style={{ borderBottom: '1px solid #1c1c2b' }}>
                  <td style={{ padding: 8 }}>{new Date(t.executed_at).toLocaleString()}</td>
                  <td style={{ padding: 8 }}>{t.symbol}</td>
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
            <button onClick={() => exportCsv('positions.csv', visiblePositions)} style={{ background: '#8ab4ff', color: '#000', border: 'none', borderRadius: 8, padding: '8px 12px', fontWeight: 700 }}>Export CSV</button>
          </div>
        </div>
        <div style={{ marginTop: 10, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ color: '#8b8ba7', textAlign: 'left', borderBottom: '1px solid #2a2a3f' }}>
                <th style={{ padding: 8 }}>Symbol</th>
                <th style={{ padding: 8 }}>Side</th>
                <th style={{ padding: 8 }}>Amount</th>
                <th style={{ padding: 8 }}>Entry</th>
                <th style={{ padding: 8 }}>Mark</th>
                <th style={{ padding: 8 }}>Notional</th>
                <th style={{ padding: 8 }}>Leverage</th>
                <th style={{ padding: 8 }}>uPnL</th>
              </tr>
            </thead>
            <tbody>
              {visiblePositions.map((p) => {
                const isTop = p.symbol === positionSummary.top.symbol
                return (
                  <tr key={`${p.symbol}-${p.id}`} style={{ borderBottom: '1px solid #1c1c2b', background: isTop ? '#2b2414' : 'transparent' }}>
                    <td style={{ padding: 8 }}>{p.symbol}{isTop ? ' ⭐' : ''}</td>
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
                <th style={{ padding: 8 }}>Time</th>
                <th style={{ padding: 8 }}>Endpoint</th>
                <th style={{ padding: 8 }}>Status</th>
                <th style={{ padding: 8 }}>Actor</th>
                <th style={{ padding: 8 }}>Symbol</th>
                <th style={{ padding: 8 }}>Duration</th>
                <th style={{ padding: 8 }}>Detail</th>
              </tr>
            </thead>
            <tbody>
              {syncEvents.map((e) => (
                <tr key={e.id} style={{ borderBottom: '1px solid #1c1c2b' }}>
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
            <button onClick={loadSyncEvents} style={{ background: '#00f3ff', color: '#000', border: 'none', borderRadius: 8, padding: '6px 10px', fontWeight: 700 }}>Refresh</button>
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
            <button onClick={loadAuditTradesMeta} style={{ background: '#00f3ff', color: '#000', border: 'none', borderRadius: 8, padding: '6px 10px', fontWeight: 700 }}>Refresh page checksum</button>
          </div>
        </div>
      </div>
      </>
      )}
    </div>
  )
}

export default Dashboard
