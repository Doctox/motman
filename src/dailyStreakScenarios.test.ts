import { describe, expect, it } from 'vitest'

import scenarios from './data/dailyStreakScenarios.json'
import { computeStreak, freezeDaysToUse } from './dailyStreakRule'

// ─────────────────────────────────────────────────────────────────────────────
// BANC D'ESSAI COMMUN AUX DEUX MOTEURS DE SÉRIE.
//
// La série du défi du jour est calculée DEUX FOIS, dans deux langages :
//   • ici, en TypeScript (`src/dailyStreakRule.ts`), pour ce que le joueur VOIT ;
//   • en plpgsql (`private.daily_streak_from_history`, `private.daily_freeze_days`),
//     pour ce que le serveur ENREGISTRE et PAIE.
//
// Les faire coïncider « en relisant bien » a déjà échoué une fois (le pont
// oublié côté SQL en septembre 2026). `src/data/dailyStreakScenarios.json` est
// donc lu par DEUX bancs d'essai : celui-ci, et `scripts/test_shared_rules_sql.mjs`
// (npm run test:rules), qui passe les mêmes cas à la vraie base, en transaction
// annulée. Un cas ajouté est vérifié des deux côtés.
// ─────────────────────────────────────────────────────────────────────────────

describe('série, moteur TypeScript, banc d’essai commun', () => {
  for (const s of scenarios.series) {
    it(s.nom, () => {
      expect(computeStreak({ winDays: s.victoires, frozenDays: s.gels, today: s.aujourdhui, pocket: s.poche })).toEqual({
        streak: s.attendu.serieAujourdhui,
        streakAtLastWin: s.attendu.serieDerniereVictoire,
        best: s.attendu.meilleure,
        lastWin: s.attendu.derniereVictoire,
      })
    })
  }
})

describe('consommation des gels, moteur TypeScript, banc d’essai commun', () => {
  for (const c of scenarios.consommation) {
    it(c.nom, () => {
      expect(freezeDaysToUse(c.derniereActivite, c.victoire, c.poche)).toEqual(c.joursGeles)
    })
  }
})
