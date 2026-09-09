import { describe, expect, it } from 'vitest'

import fixtures from './data/sharedRuleScenarios.json'
import { experienceGoalForLevel, MAX_PLAYER_LEVEL } from './experienceCurve'
import { RANKED_DIVISIONS } from './ranked'

// ─────────────────────────────────────────────────────────────────────────────
// RÈGLES ÉCRITES DANS DEUX LANGAGES — côté TypeScript.
//
// Même dispositif que `dailyStreakScenarios.test.ts`, pour les deux autres
// règles que le projet écrit en double faute de pouvoir importer du TypeScript
// dans plpgsql :
//
//   • la COURBE D'XP — `experienceCurve.ts` ici, `server_award_progress`
//     (`goal := 100 + (next_level - 1) * 15`) là-bas. Celle d'ici annonce le
//     palier au joueur ; celle de là-bas accorde réellement les niveaux ;
//   • les PALIERS DE CLASSE — `RANKED_DIVISIONS` ici,
//     `private.ranked_tier_index` là-bas.
//
// Les deux jeux concordaient quand on les a comparés pour la première fois, le
// 08/09/2026. Rien ne les y obligeait : c'est exactement l'état dans lequel se
// trouvait la série du défi du jour avant qu'on découvre qu'elle avait, elle,
// silencieusement divergé.
//
// `src/data/sharedRuleScenarios.json` est lu par CE banc d'essai et par
// `npm run test:rules`, qui pose les mêmes questions à PostgreSQL. Un cas ajouté
// est vérifié des deux côtés.
// ─────────────────────────────────────────────────────────────────────────────

describe('courbe d’XP, côté TypeScript', () => {
  it('respecte le plafond de niveau du banc d’essai', () => {
    expect(MAX_PLAYER_LEVEL).toBe(fixtures.xp.maxNiveau)
  })

  for (const cas of fixtures.xp.cas) {
    it(`niveau ${cas.niveau} → palier ${cas.palier}`, () => {
      expect(experienceGoalForLevel(cas.niveau)).toBe(cas.palier)
    })
  }
})

describe('paliers de classe, côté TypeScript', () => {
  // On compare l'INDICE, pas le libellé : c'est ce que rend `ranked_tier_index`,
  // et les libellés (« Or », « Platine ») n'existent que côté client.
  for (const cas of fixtures.rangs.cas) {
    it(`${cas.points} points → rang ${cas.rang} (${cas.id})`, () => {
      const indice = [...RANKED_DIVISIONS]
        .map((division, index) => ({ division, index }))
        .reverse()
        .find(({ division }) => cas.points >= division.minimum)?.index
      expect(indice).toBe(cas.rang)
      expect(RANKED_DIVISIONS[cas.rang].id).toBe(cas.id)
    })
  }
})
