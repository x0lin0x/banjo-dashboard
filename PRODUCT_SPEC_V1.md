# PRODUCT_SPEC_V1.md — Banjo Trading Dashboard

Statut: Draft v1 (MVP orienté exécution réelle)
Owner: Banjo
Date: 2026-03-07

## 1) Vision
Construire un dashboard de pilotage pour un bot d’algo-trading Binance Perps, orienté décision et contrôle du risque, avec traçabilité complète et parité backtest ↔ live.

## 2) Principes produit (non négociables)
1. Décision > cosmétique
2. Données auditables (timestamps UTC, ids stables, trails)
3. Robustesse d’abord (latence acceptable, erreurs visibles)
4. Simplicité opérationnelle (un front canonique)

## 3) Personas
- Trader-opérateur (toi): surveille risque, exécution, anomalies.
- Quant (toi/Banjo): compare hypothèse vs réalité, valide performance.

## 4) MVP Scope (S0)
### 4.1 Overview
- Equity curve (session / 7j / 30j)
- Realized PnL / Unrealized PnL
- Drawdown courant + Max DD fenêtre
- Winrate / PF / Avg R (si disponible)

### 4.2 Positions Live
- Symbol, side, size, entry, mark, liquidation, leverage
- Unrealized PnL par position
- Exposition notional agrégée (long/short/net)

### 4.3 Trades Feed
- Historique exécutions récent (filtrable)
- Fees, slippage estimé, realized pnl
- Liens vers signal/decision id si disponible

### 4.4 Risk Panel
- Caps d’exposition (global + par asset)
- Concentration (top symbol share)
- Alertes: drawdown, leverage, marge, anomalies sync

### 4.5 Sync & Health
- État connecteurs (Binance/API/DB)
- Dernière synchro réussie
- Erreurs visibles + compteur retries

## 5) Hors scope MVP (S1/S2)
- Multi-exchange complet
- Optimiseur de stratégie intégré
- OMS avancé (modif/annulation ordres manuels)
- Permissions multi-utilisateur

## 6) Architecture cible
- Backend: FastAPI + SQLAlchemy
- DB: Postgres (canonique), SQLite uniquement local dev
- Front: React/Vite (`new-dashboard` canonique)
- Ingestion: workers sync Binance (trades, positions, funding)
- Scheduler: jobs périodiques + health checks

## 7) UX minimale
- Home: KPI cards + equity + alerts
- Tabs: Positions / Trades / Risk / Diagnostics
- Filtres: période, symbole, strategy_tag
- Dark mode lisible, priorité densité d’info

## 8) Qualité des données
- Tout en UTC
- IDs canoniques: trade_id, order_id, decision_id, signal_id
- Idempotence sync (upsert, pas de doublons)
- Contrôles cohérence PnL/equity

## 9) KPIs de réussite MVP (30 jours)
- Uptime backend > 99%
- Sync sans erreur > 99% runs
- Écart PnL dashboard vs source exchange < 0.5% tolérance journalière
- Temps de chargement page < 2s local

## 10) Référence d’inspiration (TradeNote)
Approche recommandée: étudier patterns (module layout, journaling, workflow, UX), sans forker le code directement.
Objectif: réutiliser concepts, reconstruire proprement le produit Banjo-centric.
