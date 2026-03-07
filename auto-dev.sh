#!/bin/bash
PROJECT_DIR="/home/guts/clawd/trading-dashboard/new-dashboard"
LOG_FILE="/home/guts/clawd/trading-dashboard/auto-dev.log"

echo "[$(date)] 🤖 Auto-dev démarrage" >> $LOG_FILE

cd $PROJECT_DIR 2>/dev/null || { echo "[$(date)] ❌ Projet non trouvé" >> $LOG_FILE; exit 1; }

# Vérifie Dashboard.jsx
if [ -f "src/Dashboard.jsx" ]; then
    echo "[$(date)] ✅ Dashboard.jsx trouvé" >> $LOG_FILE
else
    echo "[$(date)] ⚠️ Dashboard.jsx manquant" >> $LOG_FILE
fi

echo "[$(date)] ✅ Auto-dev terminé" >> $LOG_FILE
