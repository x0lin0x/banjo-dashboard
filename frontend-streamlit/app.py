import streamlit as st
import requests
import pandas as pd
import plotly.graph_objects as go

st.set_page_config(page_title="⚡ CLAWD TRADE", layout="wide")

API_URL = "http://localhost:8000/api/v1"

# Dark mode CSS
st.markdown("""
<style>
    .main { background-color: #0a0a0f; }
    h1 { color: #b026ff; text-shadow: 0 0 10px #b026ff; }
    .stMetric { background: #1a1a2e; padding: 15px; border-radius: 10px; border: 1px solid #333; }
</style>
""", unsafe_allow_html=True)

st.title("⚡ CLAWD TRADE")

# Sidebar
page = st.sidebar.radio("Navigation", ["Dashboard", "Trades", "Positions"])
if st.sidebar.button("🔄 SYNC DATA"):
    requests.post(f"{API_URL}/sync/all")
    st.rerun()

# Dashboard
if page == "Dashboard":
    stats = requests.get(f"{API_URL}/stats/overview").json()
    
    col1, col2, col3, col4 = st.columns(4)
    col1.metric("📊 POSITIONS", stats['total_positions'])
    col2.metric("⚡ TRADES", stats['total_trades'])
    col3.metric("💰 REALIZED P&L", f"${float(stats['total_realized_pnl']):.2f}")
    col4.metric("📈 UNREALIZED P&L", f"${float(stats['total_unrealized_pnl']):.2f}")

elif page == "Trades":
    data = requests.get(f"{API_URL}/trades?limit=100").json()
    if data.get('trades'):
        df = pd.DataFrame(data['trades'])
        st.dataframe(df[['symbol', 'side', 'price', 'qty', 'realized_pnl']], use_container_width=True)

elif page == "Positions":
    data = requests.get(f"{API_URL}/positions").json()
    if data.get('positions'):
        df = pd.DataFrame(data['positions'])
        st.dataframe(df[['symbol', 'position_amt', 'entry_price', 'unrealized_pnl', 'leverage']], use_container_width=True)
