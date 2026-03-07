const API_URL = 'http://localhost:8000/api/v1';
export const getStats = () => fetch(`${API_URL}/stats/overview`).then(r => r.json());
export const getTrades = () => fetch(`${API_URL}/trades?limit=100`).then(r => r.json());
export const getPositions = () => fetch(`${API_URL}/positions`).then(r => r.json());
