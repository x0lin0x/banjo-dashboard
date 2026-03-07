import { useEffect, useState } from 'react'

const API_URL = 'http://localhost:8000/api/v1'

function Dashboard() {
  const [stats, setStats] = useState(null)

  useEffect(() => {
    fetch(API_URL + '/stats/overview')
      .then(r => r.json())
      .then(setStats)
  }, [])

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0f', color: 'white', padding: 24 }}>
      <h1 style={{ color: '#b026ff', textShadow: '0 0 10px #b026ff' }}>⚡ DASHBOARD</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 24, marginTop: 32 }}>
        <div style={{ background: '#1a1a2e', border: '1px solid #b026ff', padding: 24, borderRadius: 12, boxShadow: '0 0 20px rgba(176,38,255,0.2)' }}>
          <p style={{ color: '#888' }}>POSITIONS</p>
          <p style={{ fontSize: 32, fontWeight: 'bold', color: '#b026ff' }}>{stats?.total_positions || 0}</p>
        </div>
        <div style={{ background: '#1a1a2e', border: '1px solid #00f3ff', padding: 24, borderRadius: 12, boxShadow: '0 0 20px rgba(0,243,255,0.2)' }}>
          <p style={{ color: '#888' }}>TRADES</p>
          <p style={{ fontSize: 32, fontWeight: 'bold', color: '#00f3ff' }}>{stats?.total_trades || 0}</p>
        </div>
        <div style={{ background: '#1a1a2e', border: '1px solid #39ff14', padding: 24, borderRadius: 12, boxShadow: '0 0 20px rgba(57,255,20,0.2)' }}>
          <p style={{ color: '#888' }}>REALIZED P&L</p>
          <p style={{ fontSize: 32, fontWeight: 'bold', color: parseFloat(stats?.total_realized_pnl) >= 0 ? '#39ff14' : '#ff3131' }}>
            ${parseFloat(stats?.total_realized_pnl || 0).toFixed(2)}
          </p>
        </div>
        <div style={{ background: '#1a1a2e', border: '1px solid #ff10f0', padding: 24, borderRadius: 12, boxShadow: '0 0 20px rgba(255,16,240,0.2)' }}>
          <p style={{ color: '#888' }}>UNREALIZED P&L</p>
          <p style={{ fontSize: 32, fontWeight: 'bold', color: parseFloat(stats?.total_unrealized_pnl) >= 0 ? '#39ff14' : '#ff3131' }}>
            ${parseFloat(stats?.total_unrealized_pnl || 0).toFixed(2)}
          </p>
        </div>
      </div>
    </div>
  )
}

export default Dashboard
