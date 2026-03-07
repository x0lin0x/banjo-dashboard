# BACKLOG_V1.md — Priorisation

## S0 — Runnable baseline (immédiat)
- [x] Endpoints `/stats/overview`, `/trades`, `/positions`
- [x] Front `new-dashboard` lisant stats overview
- [x] README runbook
- [ ] Docker run end-to-end validé local
- [ ] Vérifier streamlit avec nouveaux endpoints

## S1 — Produit utile (1 sprint)
- [x] Endpoint equity timeseries `/stats/equity`
- [x] Endpoint risk `/risk/exposure`
- [x] Cards DD / Gross exposure / concentration
- [x] Table trades avec filtres (symbol, time/window) + tri + pagination
- [~] Table positions enrichie (notional livré, liq price/margin mode en attente)
- [x] Diagnostics connecteurs + erreurs visibles (endpoint backend)

## S1.5 — V1.2 UX/ops (livré)
- [x] Auto-refresh configurable (off/10s/30s/60s)
- [x] Filtres fenêtre (24h/7d/30d) sur overview + equity
- [x] Export CSV trades/positions
- [x] Panel runtime (last sync + db latency)

## S2 — Qualité quant / parity
- [ ] Ajout `signal_id` / `decision_id` dans pipeline
- [ ] Reconciliation PnL dashboard vs exchange
- [ ] Funding fees agrégés et affichés
- [ ] Alertes seuils (DD, levier, erreurs sync)
- [ ] Export CSV auditable (trades/equity)

## S3 — Extensions
- [ ] Multi-stratégies / tags TradingView
- [ ] Multi-exchange (Hyperliquid)
- [ ] Auth basique + rôles lecture/ops

## Décisions
- Front canonique: `new-dashboard`
- Streamlit reste en fallback debug rapide
- Pas de fork direct: inspiration TradeNote, implémentation propre
