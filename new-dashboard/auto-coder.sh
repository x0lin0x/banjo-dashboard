#!/bin/bash
# Auto-coder - Travaille sur le dashboard pendant 6h

PROJECT_DIR="/home/guts/clawd/trading-dashboard/new-dashboard"
LOG="/home/guts/clawd/trading-dashboard/auto-coder.log"
STEP_FILE="$PROJECT_DIR/.current-step"

echo "[$(date '+%H:%M')] 🚀 Auto-coder démarrage" >> $LOG

cd $PROJECT_DIR || exit 1

# Détermine l'étape actuelle
STEP=$(cat $STEP_FILE 2>/dev/null || echo "0")
echo "[$(date '+%H:%M')] 📍 Étape $STEP" >> $LOG

case $STEP in
  0)
    echo "[$(date '+%H:%M')] 📝 Ajout API service" >> $LOG
    mkdir -p src/services
    cat > src/services/api.js << 'ENDAPI'
const API_URL = 'http://localhost:8000/api/v1';
export const getStats = () => fetch(`${API_URL}/stats/overview`).then(r => r.json());
export const getTrades = () => fetch(`${API_URL}/trades?limit=100`).then(r => r.json());
export const getPositions = () => fetch(`${API_URL}/positions`).then(r => r.json());
ENDAPI
    echo "1" > $STEP_FILE
    ;;
    
  1)
    echo "[$(date '+%H:%M')] 📝 Ajout CSS néon" >> $LOG
    cat > src/index.css << 'ENDCSS'
body { background: #0a0a0f; color: white; margin: 0; font-family: sans-serif; }
.card { background: #1a1a2e; border-radius: 12px; padding: 20px; margin: 10px; }
.neon-purple { border: 1px solid #b026ff; box-shadow: 0 0 20px rgba(176,38,255,0.2); }
.neon-cyan { border: 1px solid #00f3ff; box-shadow: 0 0 20px rgba(0,243,255,0.2); }
.neon-green { border: 1px solid #39ff14; box-shadow: 0 0 20px rgba(57,255,20,0.2); }
.neon-pink { border: 1px solid #ff10f0; box-shadow: 0 0 20px rgba(255,16,240,0.2); }
h1 { color: #b026ff; text-shadow: 0 0 10px #b026ff; }
ENDCSS
    echo "2" > $STEP_FILE
    ;;
    
  2)
    echo "[$(date '+%H:%M')] 📝 Amélioration Dashboard.jsx" >> $LOG
    cat > src/Dashboard.jsx << 'ENDJSX'
import { useEffect, useState } from 'react'
import { getStats, getTrades, getPositions } from './services/api'

function Dashboard() {
  const [stats, setStats] = useState(null)
  const [trades, setTrades] = useState([])
  const [positions, setPositions] = useState([])

  useEffect(() => {
    getStats().then(setStats)
    getTrades().then(d => setTrades(d.trades || []))
    getPositions().then(d => setPositions(d.positions || []))
  }, [])

  return (
    <div style={{ padding: 24 }}>
      <h1>⚡ CLAWD TRADE</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
        <div className="card neon-purple">
          <p>POSITIONS</p>
          <h2>{stats?.total_positions || 0}</h2>
        </div>
        <div className="card neon-cyan">
          <p>TRADES</p>
          <h2>{stats?.total_trades || 0}</h2>
        </div>
        <div className="card neon-green">
          <p>REALIZED P&L</p>
          <h2>${parseFloat(stats?.total_realized_pnl || 0).toFixed(2)}</h2>
        </div>
        <div className="card neon-pink">
          <p>UNREALIZED P&L</p>
          <h2>${parseFloat(stats?.total_unrealized_pnl || 0).toFixed(2)}</h2>
        </div>
      </div>
      
      <h2 style={{ marginTop: 32, color: '#00f3ff' }}>Recent Trades ({trades.length})</h2>
      <div className="card">
        {trades.slice(0, 10).map(t => (
          <div key={t.id} style={{ display: 'flex', gap: 16, padding: 8, borderBottom: '1px solid #333' }}>
            <span style={{ color: t.side === 'BUY' ? '#39ff14' : '#ff3131' }}>{t.side}</span>
            <span>{t.symbol}</span>
            <span>${parseFloat(t.price).toFixed(2)}</span>
            <span style={{ color: parseFloat(t.realized_pnl) >= 0 ? '#39ff14' : '#ff3131' }}>
              ${parseFloat(t.realized_pnl).toFixed(2)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default Dashboard
ENDJSX
    echo "3" > $STEP_FILE
    ;;
    
  3)
    echo "[$(date '+%H:%M')] 📝 Mise à jour App.jsx" >> $LOG
    cat > src/App.jsx << 'ENDAPP'
import Dashboard from './Dashboard'
import './index.css'

function App() {
  return <Dashboard />
}

export default App
ENDAPP
    echo "4" > $STEP_FILE
    ;;
    
  *)
    echo "[$(date '+%H:%M')] ✅ Toutes les étapes terminées" >> $LOG
    ;;
esac

echo "[$(date '+%H:%M')] ✅ Auto-coder terminé" >> $LOG
