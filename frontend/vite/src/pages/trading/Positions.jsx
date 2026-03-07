import { useEffect, useState } from 'react';
import { Grid, Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, Chip } from '@mui/material';
import { getPositions } from '../../services/api';
import MainCard from '../../components/MainCard';

const Positions = () => {
  const [positions, setPositions] = useState([]);

  useEffect(() => {
    fetchPositions();
  }, []);

  const fetchPositions = async () => {
    const data = await getPositions();
    setPositions(data.positions || []);
  };

  return (
    <Grid container spacing={3}>
      <Grid item xs={12}>
        <Typography variant="h2" sx={{ color: '#673ab7', fontWeight: 'bold', mb: 2 }}>
          📈 Positions
        </Typography>
        <Typography variant="subtitle1" color="textSecondary" sx={{ mb: 3 }}>
          {positions.length} open positions
        </Typography>
      </Grid>

      <Grid item xs={12}>
        <MainCard>
          <TableContainer component={Paper} sx={{ bgcolor: 'transparent', boxShadow: 'none' }}>
            <Table>
              <TableHead>
                <TableRow sx={{ bgcolor: '#f5f5f5' }}>
                  <TableCell><strong>Symbol</strong></TableCell>
                  <TableCell><strong>Amount</strong></TableCell>
                  <TableCell><strong>Entry Price</strong></TableCell>
                  <TableCell><strong>Mark Price</strong></TableCell>
                  <TableCell><strong>Unrealized P&L</strong></TableCell>
                  <TableCell><strong>Leverage</strong></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {positions.map((pos) => (
                  <TableRow key={pos.symbol} hover>
                    <TableCell sx={{ fontWeight: 'bold' }}>{pos.symbol}</TableCell>
                    <TableCell sx={{ color: '#2196f3' }}>{parseFloat(pos.position_amt).toFixed(4)}</TableCell>
                    <TableCell>${parseFloat(pos.entry_price).toFixed(2)}</TableCell>
                    <TableCell>${parseFloat(pos.mark_price).toFixed(2)}</TableCell>
                    <TableCell sx={{ 
                      color: parseFloat(pos.unrealized_pnl) >= 0 ? '#4caf50' : '#f44336',
                      fontWeight: 'bold'
                    }}>
                      ${parseFloat(pos.unrealized_pnl).toFixed(2)}
                    </TableCell>
                    <TableCell>
                      <Chip 
                        label={`${pos.leverage}x`} 
                        size="small"
                        sx={{ 
                          bgcolor: '#f3e5f5',
                          color: '#673ab7',
                          fontWeight: 'bold'
                        }}
                      />
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

export default Positions;
