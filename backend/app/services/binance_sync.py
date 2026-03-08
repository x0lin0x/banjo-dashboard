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
        # Reduce Binance pressure from frequent dashboard refreshes.
        self._balance_cache: dict[str, tuple[float, Decimal | None]] = {}
        self._balance_cache_ttl_seconds: int = 30

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

    def _fetch_balance_row(self, asset: str = "USDT") -> dict | None:
        wanted = asset.upper().strip()

        if not self.api_key or not self.api_secret:
            logger.warning("No Binance credentials found. Returning mock balance row.")
            return {"asset": wanted, "balance": "10000", "availableBalance": "9900"}

        endpoint = "/fapi/v2/balance"
        rows = self._signed_get(endpoint)
        for row in rows:
            if str(row.get("asset", "")).upper() == wanted:
                return row
        return None

    def fetch_account_balance(self, asset: str = "USDT") -> Decimal | None:
        wanted = asset.upper().strip()

        # short in-memory cache to avoid hammering Binance on every dashboard refresh
        now = time.time()
        cached = self._balance_cache.get(wanted)
        if cached and (now - cached[0]) < self._balance_cache_ttl_seconds:
            return cached[1]

        row = self._fetch_balance_row(asset=wanted)
        value = None
        if row is not None:
            raw = row.get("balance", row.get("crossWalletBalance", "0"))
            value = Decimal(str(raw))

        self._balance_cache[wanted] = (now, value)
        return value

    def fetch_account_available_balance(self, asset: str = "USDT") -> Decimal | None:
        row = self._fetch_balance_row(asset=asset)
        if row is None:
            return None
        raw = row.get("availableBalance", row.get("balance", "0"))
        return Decimal(str(raw))

    def _fetch_funding_income_rows(
        self,
        start_time_ms: int | None = None,
        end_time_ms: int | None = None,
        max_pages: int = 5,
    ) -> list[dict]:
        if not self.api_key or not self.api_secret:
            return []

        out: list[dict] = []
        page = 1
        current_start = start_time_ms

        while page <= max_pages:
            params = {
                "incomeType": "FUNDING_FEE",
                "limit": 1000,
            }
            if current_start is not None:
                params["startTime"] = int(current_start)
            if end_time_ms is not None:
                params["endTime"] = int(end_time_ms)

            rows = self._signed_get("/fapi/v1/income", params=params)
            if not rows:
                break

            out.extend(rows)

            if len(rows) < 1000:
                break

            last_time = rows[-1].get("time")
            if not last_time:
                break
            current_start = int(last_time) + 1
            page += 1

        return out

    def fetch_funding_fees_sum(
        self,
        start_time_ms: int | None = None,
        end_time_ms: int | None = None,
        max_pages: int = 5,
    ) -> Decimal | None:
        """Return sum of FUNDING_FEE income over range."""
        if not self.api_key or not self.api_secret:
            return Decimal("0")

        total = Decimal("0")
        rows = self._fetch_funding_income_rows(start_time_ms=start_time_ms, end_time_ms=end_time_ms, max_pages=max_pages)
        for r in rows:
            total += Decimal(str(r.get("income", "0")))
        return total

    def fetch_funding_fees_by_symbol(
        self,
        start_time_ms: int | None = None,
        end_time_ms: int | None = None,
        max_pages: int = 5,
    ) -> dict[str, Decimal]:
        rows = self._fetch_funding_income_rows(start_time_ms=start_time_ms, end_time_ms=end_time_ms, max_pages=max_pages)
        out: dict[str, Decimal] = {}
        for r in rows:
            symbol = str(r.get("symbol", "UNKNOWN") or "UNKNOWN")
            income = Decimal(str(r.get("income", "0")))
            out[symbol] = out.get(symbol, Decimal("0")) + income
        return out

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
                exit_reason=str(raw.get("exitReason", "")) or None,
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
