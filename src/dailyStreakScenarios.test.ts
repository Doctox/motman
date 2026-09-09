import { describe, expect, it } from 'vitest'

import scenarios from './data/dailyStreakScenarios.json'
import { advanceStreak, emptyDailyChallengeState } from './dailyChallenge'

// ─────────────────────────────────────────────────────────────────────────────
// BANC D'ESSAI COMMUN AUX DEUX MOTEURS DE SÉRIE.
//
// La série du défi du jour est calculée DEUX FOIS, dans deux langages :
//   • ici, en TypeScript (`advanceStreak`), pour ce que le joueur VOIT ;
//   • en plpgsql (`private.daily_streak_from_days`), pour ce que le serveur PAIE.
//
// Les faire coïncider « en relisant bien » ne marche pas : la première version
// SQL prétendait recopier `advanceStreak` à l'identique et avait pourtant omis
// la fenêtre de récupération entière. Un joueur remonté à 30 jours par le pont
// voyait « palier atteint » à l'écran et n'était jamais payé.
//
// D'où ce fichier. `src/data/dailyStreakScenarios.json` est la liste de cas, et
// elle est lue par DEUX bancs d'essai :
//   • celui-ci, qui la passe au moteur TypeScript ;
//   • `scripts/test_shared_rules_sql.mjs` (npm run test:rules), qui la passe au
//     moteur SQL sur la vraie base, en transaction annulée.
//
// Ajouter un cas ici le fait donc vérifier des deux côtés d'un coup. Une
// divergence entre les moteurs devient un test rouge au lieu d'une plainte de
// joueur.
//
// `apresDerniereVictoire` est ce qui se compare entre les deux moteurs : c'est
// l'état au moment de la dernière victoire, dont `meilleure` — la seule valeur
// qui déclenche un versement. `serieAujourdhui` (une série peut être morte sans
// qu'aucune victoire ne l'ait signalée) n'existe que côté SQL et se vérifie dans
// l'autre banc d'essai.
// ─────────────────────────────────────────────────────────────────────────────

type Scenario = {
  nom: string
  pourquoi: string
  jours: string[]
  aujourdhui: string
  apresDerniereVictoire: { serie: number; meilleure: number; gels: number }
  serieAujourdhui: number
}

describe('moteur de série TypeScript, sur le banc d’essai commun', () => {
  for (const scenario of scenarios as Scenario[]) {
    it(scenario.nom, () => {
      const state = scenario.jours.reduce(
        (current, day) => advanceStreak(current, day).state,
        emptyDailyChallengeState(),
      )
      expect(state.currentStreak).toBe(scenario.apresDerniereVictoire.serie)
      expect(state.longestStreak).toBe(scenario.apresDerniereVictoire.meilleure)
      expect(state.freezes).toBe(scenario.apresDerniereVictoire.gels)
      expect(state.lastWonDay).toBe(scenario.jours.at(-1) ?? null)
    })
  }
})
