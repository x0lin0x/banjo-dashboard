import hashlib, hmac, logging, time
from datetime import datetime, timezone
from decimal import Decimal
from urllib.parse import urlencode
import requests
from sqlalchemy.orm import Session
from app.config import settings
from app.models.position import Position
from app.models.trade import Trade

logger = logging.getLogger(__name__)

class BinanceSyncService:
    def __init__(self, api_key: str, api_secret: str, base_url: str) -> None:
        self.api_key = api_key
        self.api_secret = api_secret
        self.base_url = base_url.rstrip("/")

    def _signed_get(self, endpoint: str, params: dict | None = None) -> list[dict]:
        if not self.api_key or not self.api_secret:
            raise ValueError("Binance API credentials are missing.")
        payload = params.copy() if params else {}
        payload["timestamp"] = int(time.time() * 1000)
        query = urlencode(payload)
        signature = hmac.new(self.api_secret.encode("utf-8"), query.encode("utf-8"), hashlib.sha256).hexdigest()
        url = f"{self.base_url}{endpoint}?{query}&signature={signature}"
        headers = {"X-MBX-APIKEY": self.api_key}
        response = requests.get(url, headers=headers, timeout=20)
        response.raise_for_status()
        return response.json() if isinstance(response.json(), list) else []

    def fetch_recent_trades(self, symbol: str = "BTCUSDT", limit: int = 100) -> list[dict]:
        if not self.api_key or not self.api_secret:
            logger.warning("No Binance credentials found. Returning mock trades.")
            now_ms = int(time.time() * 1000)
            return [{"id": f"mock-{now_ms}", "symbol": symbol, "orderId": "mock-order", "side": "BUY", "price": "50000", "qty": "0.001", "quoteQty": "50", "commission": "0.01", "commissionAsset": "USDT", "realizedPnl": "0", "time": now_ms, "signalId": f"sig-{symbol}-{now_ms}", "decisionId": f"dec-{symbol}-{now_ms}"}]
        endpoint = "/fapi/v1/userTrades"
        params = {"symbol": symbol, "limit": min(max(limit, 1), 1000)}
        return self._signed_get(endpoint, params=params)

    def fetch_positions(self) -> list[dict]:
        if not self.api_key or not self.api_secret:
            logger.warning("No Binance credentials found. Returning mock positions.")
            return [{"symbol": "BTCUSDT", "positionAmt": "0.001", "entryPrice": "50000", "markPrice": "50500", "unRealizedProfit": "0.5", "leverage": "10"}]
        endpoint = "/fapi/v2/positionRisk"
        return self._signed_get(endpoint)

    def fetch_account_balance(self, asset: str = "USDT") -> Decimal | None:
        if not self.api_key or not self.api_secret:
            logger.warning("No Binance credentials found. Returning mock balance.")
            return Decimal("10000")

        endpoint = "/fapi/v2/balance"
        rows = self._signed_get(endpoint)
        wanted = asset.upper().strip()
        for row in rows:
            if str(row.get("asset", "")).upper() != wanted:
                continue
            # crossWalletBalance is the futures wallet balance for this asset.
            return Decimal(str(row.get("crossWalletBalance", row.get("balance", "0"))))
        return None

    def sync_trades(self, db: Session, symbol: str = "BTCUSDT", limit: int = 100) -> int:
        trades = self.fetch_recent_trades(symbol=symbol, limit=limit)
        inserted = 0
        for raw in trades:
            trade_id = str(raw.get("id"))
            if not trade_id or db.query(Trade).filter(Trade.binance_trade_id == trade_id).first():
                continue
            trade = Trade(
                binance_trade_id=trade_id,
                symbol=raw.get("symbol", symbol),
                order_id=str(raw.get("orderId", "")) or None,
                side=raw.get("side", "BUY"),
                price=Decimal(str(raw.get("price", "0"))),
                qty=Decimal(str(raw.get("qty", "0"))),
                quote_qty=Decimal(str(raw.get("quoteQty", "0"))),
                commission=Decimal(str(raw.get("commission", "0"))),
                commission_asset=raw.get("commissionAsset", "USDT"),
                realized_pnl=Decimal(str(raw.get("realizedPnl", "0"))),
                signal_id=str(raw.get("signalId", "")) or None,
                decision_id=str(raw.get("decisionId", "")) or None,
                executed_at=datetime.fromtimestamp(int(raw.get("time", int(time.time() * 1000))) / 1000, tz=timezone.utc),
            )
            db.add(trade)
            inserted += 1
        if inserted:
            db.commit()
        return inserted

    def sync_positions(self, db: Session) -> int:
        positions = self.fetch_positions()
        updated = 0
        for raw in positions:
            symbol = raw.get("symbol")
            if not symbol:
                continue
            pos = db.query(Position).filter(Position.symbol == symbol).first()
            if not pos:
                pos = Position(symbol=symbol)
                db.add(pos)
            pos.position_amt = Decimal(str(raw.get("positionAmt", "0")))
            pos.entry_price = Decimal(str(raw.get("entryPrice", "0")))
            pos.mark_price = Decimal(str(raw.get("markPrice", "0")))
            pos.unrealized_pnl = Decimal(str(raw.get("unRealizedProfit", "0")))
            pos.leverage = int(raw.get("leverage", 1))
            updated += 1
        if updated:
            db.commit()
        return updated

binance_sync_service = BinanceSyncService(
    api_key=settings.binance_api_key,
    api_secret=settings.binance_api_secret,
    base_url=settings.binance_base_url,
)
