const API_URL = 'http://localhost:8000/api/v1';

export const getStats = async () => {
  const res = await fetch(`${API_URL}/stats/overview`);
  return res.json();
};

export const getTrades = async () => {
  const res = await fetch(`${API_URL}/trades?limit=100`);
  return res.json();
};

export const getPositions = async () => {
  const res = await fetch(`${API_URL}/positions`);
  return res.json();
};

export const syncData = async () => {
  const res = await fetch(`${API_URL}/sync/all`, { method: 'POST' });
  return res.json();
};
