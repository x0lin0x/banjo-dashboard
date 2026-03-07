import { useEffect, useState } from 'react';
import { Grid, Typography, Box, Button } from '@mui/material';
import { getStats, syncData } from '../../services/api';
import MainCard from '../../components/MainCard';
import { TrendingUp, TrendingDown, Wallet, Activity, RefreshCw } from 'lucide-react';

const TradingDashboard = () => {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);

  const fetchStats = async () => {
    const data = await getStats();
    setStats(data);
  };

  const handleSync = async () => {
    setLoading(true);
    await syncData();
    await fetchStats();
    setLoading(false);
  };

  useEffect(() => {
    fetchStats();
  }, []);

  return (
    <Grid container spacing={3}>
      <Grid item xs={12}>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
          <Typography variant="h2" sx={{ color: '#673ab7', fontWeight: 'bold' }}>
            ⚡ CLAWD TRADE
          </Typography>
          <Button 
            variant="contained" 
            onClick={handleSync}
            disabled={loading}
            startIcon={<RefreshCw size={20} />}
            sx={{ 
              background: 'linear-gradient(45deg, #673ab7 30%, #e91e63 90%)',
              color: 'white',
              fontWeight: 'bold'
            }}
          >
            {loading ? 'Syncing...' : 'SYNC DATA'}
          </Button>
        </Box>
        <Typography variant="subtitle1" color="textSecondary">
          Binance Futures Dashboard
        </Typography>
      </Grid>

      <Grid item xs={12} sm={6} md={3}>
        <MainCard sx={{ bgcolor: '#f3e5f5', borderLeft: '4px solid #673ab7' }}>
          <Box display="flex" justifyContent="space-between" alignItems="center">
            <Box>
              <Typography variant="subtitle2" color="textSecondary">POSITIONS</Typography>
              <Typography variant="h3" sx={{ color: '#673ab7', fontWeight: 'bold' }}>
                {stats?.total_positions || 0}
              </Typography>
            </Box>
            <Wallet size={40} color="#673ab7" />
          </Box>
        </MainCard>
      </Grid>

      <Grid item xs={12} sm={6} md={3}>
        <MainCard sx={{ bgcolor: '#e3f2fd', borderLeft: '4px solid #2196f3' }}>
          <Box display="flex" justifyContent="space-between" alignItems="center">
            <Box>
              <Typography variant="subtitle2" color="textSecondary">TRADES</Typography>
              <Typography variant="h3" sx={{ color: '#2196f3', fontWeight: 'bold' }}>
                {stats?.total_trades || 0}
              </Typography>
            </Box>
            <Activity size={40} color="#2196f3" />
          </Box>
        </MainCard>
      </Grid>

      <Grid item xs={12} sm={6} md={3}>
        <MainCard sx={{ 
          bgcolor: parseFloat(stats?.total_realized_pnl) >= 0 ? '#e8f5e9' : '#ffebee',
          borderLeft: `4px solid ${parseFloat(stats?.total_realized_pnl) >= 0 ? '#4caf50' : '#f44336'}`
        }}>
          <Box display="flex" justifyContent="space-between" alignItems="center">
            <Box>
              <Typography variant="subtitle2" color="textSecondary">REALIZED P&L</Typography>
              <Typography variant="h3" sx={{ 
                color: parseFloat(stats?.total_realized_pnl) >= 0 ? '#4caf50' : '#f44336',
                fontWeight: 'bold'
              }}>
                ${parseFloat(stats?.total_realized_pnl || 0).toFixed(2)}
              </Typography>
            </Box>
            {parseFloat(stats?.total_realized_pnl) >= 0 ? (
              <TrendingUp size={40} color="#4caf50" />
            ) : (
              <TrendingDown size={40} color="#f44336" />
            )}
          </Box>
        </MainCard>
      </Grid>

      <Grid item xs={12} sm={6} md={3}>
        <MainCard sx={{ 
          bgcolor: parseFloat(stats?.total_unrealized_pnl) >= 0 ? '#e8f5e9' : '#ffebee',
          borderLeft: `4px solid ${parseFloat(stats?.total_unrealized_pnl) >= 0 ? '#4caf50' : '#f44336'}`
        }}>
          <Box display="flex" justifyContent="space-between" alignItems="center">
            <Box>
              <Typography variant="subtitle2" color="textSecondary">UNREALIZED P&L</Typography>
              <Typography variant="h3" sx={{ 
                color: parseFloat(stats?.total_unrealized_pnl) >= 0 ? '#4caf50' : '#f44336',
                fontWeight: 'bold'
              }}>
                ${parseFloat(stats?.total_unrealized_pnl || 0).toFixed(2)}
              </Typography>
            </Box>
            {parseFloat(stats?.total_unrealized_pnl) >= 0 ? (
              <TrendingUp size={40} color="#4caf50" />
            ) : (
              <TrendingDown size={40} color="#f44336" />
            )}
          </Box>
        </MainCard>
      </Grid>
    </Grid>
  );
};

export default TradingDashboard;
