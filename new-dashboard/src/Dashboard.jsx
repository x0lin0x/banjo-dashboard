import { useEffect, useMemo, useState } from 'react'
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

const API_URL = 'http://localhost:8000/api/v1'

const DEFAULT_ALERT_THRESHOLDS = {
  ddPct: 20,
  concentrationPct: 35,
  leverageWeighted: 8
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
  const [stats, setStats] = useState(null)
  const [risk, setRisk] = useState(null)
  const [equity, setEquity] = useState([])
  const [trades, setTrades] = useState([])
  const [positions, setPositions] = useState([])
  const [diag, setDiag] = useState(null)
  const [syncing, setSyncing] = useState(false)

  const [windowFilter, setWindowFilter] = useState('30d')
  const [refreshSec, setRefreshSec] = useState('off')
  const [alertThresholds, setAlertThresholds] = useState(DEFAULT_ALERT_THRESHOLDS)
  const [symbolFilter, setSymbolFilter] = useState('')
  const [tradeLimit, setTradeLimit] = useState(25)
  const [tradeOffset, setTradeOffset] = useState(0)
  const [tradeTotal, setTradeTotal] = useState(0)
  const [tradeSortBy, setTradeSortBy] = useState('executed_at')
  const [tradeSortDir, setTradeSortDir] = useState('desc')

  const [positionSideFilter, setPositionSideFilter] = useState('ALL')
  const [positionSortBy, setPositionSortBy] = useState('notional_usd')
  const [positionSortDir, setPositionSortDir] = useState('desc')

  const loadBase = () => {
    Promise.all([
      fetch(`${API_URL}/stats/overview?window=${windowFilter}`).then((r) => r.json()),
      fetch(`${API_URL}/risk/exposure`).then((r) => r.json()),
      fetch(`${API_URL}/stats/equity?window=${windowFilter}`).then((r) => r.json()),
      fetch(`${API_URL}/positions`).then((r) => r.json()),
      fetch(`${API_URL}/diagnostics/connectors`).then((r) => r.json())
    ])
      .then(([overview, riskRes, equityRes, positionsRes, diagRes]) => {
        setStats(overview)
        setRisk(riskRes)
        setEquity(equityRes?.points || [])
        setPositions(positionsRes?.positions || [])
        setDiag(diagRes)
      })
      .catch(() => {
        setStats(null)
        setRisk(null)
        setEquity([])
        setPositions([])
        setDiag(null)
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
    try {
      await fetch(`${API_URL}/sync/all?symbol=BTCUSDT&limit=100`, { method: 'POST' })
      loadBase()
      loadTrades()
    } finally {
      setSyncing(false)
    }
  }

  useEffect(() => {
    loadBase()
    loadTrades()
  }, [windowFilter])

  useEffect(() => {
    setTradeOffset(0)
  }, [symbolFilter, tradeLimit, windowFilter, tradeSortBy, tradeSortDir])

  useEffect(() => {
    loadTrades()
  }, [symbolFilter, tradeLimit, tradeOffset, windowFilter, tradeSortBy, tradeSortDir])

  useEffect(() => {
    if (refreshSec === 'off') return undefined
    const ms = Number(refreshSec) * 1000
    const id = setInterval(() => {
      loadBase()
      loadTrades()
    }, ms)
    return () => clearInterval(id)
  }, [refreshSec, windowFilter, symbolFilter, tradeLimit, tradeOffset, tradeSortBy, tradeSortDir])

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

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0f', color: 'white', padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ color: '#b026ff', textShadow: '0 0 10px #b026ff', marginTop: 0, marginBottom: 0 }}>⚡ BANJO TRADING DASHBOARD</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Badge ok={diag?.db?.status === 'ok'} label={`DB: ${diag?.db?.status || 'unknown'}`} />
          <Badge ok={diag?.binance?.status === 'configured'} label={`BINANCE: ${diag?.binance?.status || 'unknown'}`} />
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
          <button onClick={syncNow} disabled={syncing} style={{ background: '#00f3ff', color: '#000', border: 'none', borderRadius: 8, padding: '8px 12px', fontWeight: 700, opacity: syncing ? 0.7 : 1 }}>
            {syncing ? 'Syncing...' : 'Sync now'}
          </button>
        </div>
      </div>

      <div style={panelStyle()}>
        <h3 style={{ marginTop: 0, color: '#c8c8ff' }}>Runtime diagnostics</h3>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', color: '#cfd3ff' }}>
          <span>Last sync: <strong>{diag?.sync?.last_sync_at ? new Date(diag.sync.last_sync_at).toLocaleString() : 'n/a'}</strong></span>
          <span>DB latency: <strong>{diag?.db?.latency_ms ?? 'n/a'} ms</strong></span>
          <span>Server time: <strong>{diag?.sync?.server_time ? new Date(diag.sync.server_time).toLocaleString() : 'n/a'}</strong></span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 18, marginTop: 24 }}>
        <Card label='POSITIONS' value={stats?.total_positions ?? 0} color='#b026ff' />
        <Card label='TRADES' value={stats?.total_trades ?? 0} color='#00f3ff' />
        <Card label='REALIZED P&L' value={`$${(stats?.total_realized_pnl ?? 0).toFixed?.(2) ?? '0.00'}`} color={(stats?.total_realized_pnl ?? 0) >= 0 ? '#39ff14' : '#ff3131'} />
        <Card label='UNREALIZED P&L' value={`$${(stats?.total_unrealized_pnl ?? 0).toFixed?.(2) ?? '0.00'}`} color={(stats?.total_unrealized_pnl ?? 0) >= 0 ? '#39ff14' : '#ff3131'} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 18, marginTop: 18 }}>
        <Card label='EQUITY (proxy)' value={`$${(stats?.equity ?? 0).toFixed?.(2) ?? '0.00'}`} color='#8ab4ff' />
        <Card label='MAX DD (window)' value={`${stats?.max_drawdown_pct ?? 0}%`} color={ddColor} />
        <Card label='GROSS LONG' value={`$${(risk?.gross_long_usd ?? 0).toFixed?.(2) ?? '0.00'}`} color='#39ff14' />
        <Card label='GROSS SHORT' value={`$${(risk?.gross_short_usd ?? 0).toFixed?.(2) ?? '0.00'}`} color='#ff3131' />
      </div>

      <div style={panelStyle()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h3 style={{ marginTop: 0, color: '#ffd166', marginBottom: 0 }}>Alerts</h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input type='number' value={alertThresholds.ddPct} onChange={(e) => setAlertThresholds((p) => ({ ...p, ddPct: Number(e.target.value || 0) }))} style={{ width: 80, background: '#1a1a2e', border: '1px solid #2a2a3f', color: '#fff', borderRadius: 8, padding: '6px 8px' }} />
            <input type='number' value={alertThresholds.concentrationPct} onChange={(e) => setAlertThresholds((p) => ({ ...p, concentrationPct: Number(e.target.value || 0) }))} style={{ width: 80, background: '#1a1a2e', border: '1px solid #2a2a3f', color: '#fff', borderRadius: 8, padding: '6px 8px' }} />
            <input type='number' value={alertThresholds.leverageWeighted} onChange={(e) => setAlertThresholds((p) => ({ ...p, leverageWeighted: Number(e.target.value || 0) }))} style={{ width: 80, background: '#1a1a2e', border: '1px solid #2a2a3f', color: '#fff', borderRadius: 8, padding: '6px 8px' }} />
          </div>
        </div>
        <p style={{ color: '#8b8ba7', fontSize: 12, marginTop: 6 }}>Thresholds: DD% / Concentration% / Levier pondéré x</p>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {alerts.map((a, idx) => (
            <li key={idx} style={{ color: a.level === 'OK' ? '#39ff14' : '#ff6b6b', marginBottom: 6 }}>
              <strong>[{a.level}]</strong> {a.msg}
            </li>
          ))}
        </ul>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 18, marginTop: 18 }}>
        <Card label='LONG NOTIONAL' value={`$${positionSummary.longNotional.toFixed(2)}`} color='#39ff14' />
        <Card label='SHORT NOTIONAL' value={`$${positionSummary.shortNotional.toFixed(2)}`} color='#ff3131' />
        <Card label='TOP EXPOSURE' value={`${positionSummary.top.symbol} ($${positionSummary.top.notional.toFixed(2)})`} color='#ffd166' />
      </div>

      <div style={panelStyle()}>
        <h3 style={{ marginTop: 0, color: '#c8c8ff' }}>Equity trend ({windowFilter} realized cumulative)</h3>
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
                <th style={{ padding: 8 }}>Fee</th>
                <th style={{ padding: 8 }}>rPnL</th>
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
                  <td style={{ padding: 8 }}>{Number(t.commission || 0).toFixed(4)}</td>
                  <td style={{ padding: 8, color: Number(t.realized_pnl) >= 0 ? '#39ff14' : '#ff6b6b' }}>{Number(t.realized_pnl).toFixed(4)}</td>
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
    </div>
  )
}

export default Dashboard
