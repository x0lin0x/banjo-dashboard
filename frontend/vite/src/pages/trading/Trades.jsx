import { useEffect, useState } from 'react';
import { Grid, Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, Chip } from '@mui/material';
import { getTrades } from '../../services/api';
import MainCard from '../../components/MainCard';

const Trades = () => {
  const [trades, setTrades] = useState([]);

  useEffect(() => {
    fetchTrades();
  }, []);

  const fetchTrades = async () => {
    const data = await getTrades();
    setTrades(data.trades || []);
  };

  return (
    <Grid container spacing={3}>
      <Grid item xs={12}>
        <Typography variant="h2" sx={{ color: '#673ab7', fontWeight: 'bold', mb: 2 }}>
          💹 Trades
        </Typography>
        <Typography variant="subtitle1" color="textSecondary" sx={{ mb: 3 }}>
          {trades.length} total trades
        </Typography>
      </Grid>

      <Grid item xs={12}>
        <MainCard>
          <TableContainer component={Paper} sx={{ bgcolor: 'transparent', boxShadow: 'none' }}>
            <Table>
              <TableHead>
                <TableRow sx={{ bgcolor: '#f5f5f5' }}>
                  <TableCell><strong>Symbol</strong></TableCell>
                  <TableCell><strong>Side</strong></TableCell>
                  <TableCell><strong>Price</strong></TableCell>
                  <TableCell><strong>Quantity</strong></TableCell>
                  <TableCell><strong>P&L</strong></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {trades.slice(0, 50).map((trade) => (
                  <TableRow key={trade.id} hover>
                    <TableCell sx={{ fontWeight: 'bold' }}>{trade.symbol}</TableCell>
                    <TableCell>
                      <Chip 
                        label={trade.side} 
                        size="small"
                        sx={{ 
                          bgcolor: trade.side === 'BUY' ? '#e8f5e9' : '#ffebee',
                          color: trade.side === 'BUY' ? '#4caf50' : '#f44336',
                          fontWeight: 'bold'
                        }}
                      />
                    </TableCell>
                    <TableCell sx={{ color: '#2196f3' }}>${parseFloat(trade.price).toFixed(2)}</TableCell>
                    <TableCell>{parseFloat(trade.qty).toFixed(4)}</TableCell>
                    <TableCell sx={{ 
                      color: parseFloat(trade.realized_pnl) >= 0 ? '#4caf50' : '#f44336',
                      fontWeight: 'bold'
                    }}>
                      ${parseFloat(trade.realized_pnl).toFixed(2)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </MainCard>
      </Grid>
    </Grid>
  );
};

export default Trades;
