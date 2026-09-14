// ─────────────────────────────────────────────────────────────────────────────
// LA RÈGLE DE SÉRIE DU DÉFI DU JOUR — SOURCE UNIQUE côté TypeScript.
//
// 14/09/2026, décision du propriétaire :
//   • la série compte des VICTOIRES consécutives ;
//   • le RATTRAPAGE (le « pont » qui relevait une série cassée par deux victoires
//     d'affilée) DISPARAÎT : il était invisible et incompris (« pourquoi mon
//     cadeau jeudi et pas mercredi ? ») ;
//   • le GEL devient un objet : acheté 500 plumes à l'Épicerie, 3 au plus en
//     poche. Il PROTÈGE une journée manquée, il ne compte PAS comme une victoire ;
//   • plus de gel offert à 7 ou 30 victoires (des quêtes viendront).
//
// Un gel se consomme à la victoire qui suit le trou : s'il manque N jours et que
// le joueur a au moins N gels en poche, N gels couvrent ces jours et la série
// continue. Sinon aucun gel n'est pris et la série repart à 1.
//
// JUMEAU SQL : `private.daily_freeze_days` et `private.daily_streak_from_history`
// (migration 20260914220000). Le banc d'essai commun
// `src/data/dailyStreakScenarios.json` passe les MÊMES cas aux deux moteurs.
// Ce module n'importe rien : un worker Deno ou un script peut le charger tel quel.
// ─────────────────────────────────────────────────────────────────────────────

/** Gels en poche au plus. */
export const MAX_STREAK_FREEZES = 3
/** Prix d'un gel à l'Épicerie, en plumes. Jumeau : `server_buy_streak_freeze`. */
export const STREAK_FREEZE_PRICE = 500

const JOUR_MS = 86_400_000

function numeroDuJour(day: string): number {
  return Math.floor(Date.parse(`${day}T00:00:00Z`) / JOUR_MS)
}

function jourDuNumero(numero: number): string {
  return new Date(numero * JOUR_MS).toISOString().slice(0, 10)
}

/**
 * Les jours à couvrir d'un gel quand le joueur gagne `winDay`, sa dernière
 * journée active (victoire ou jour gelé) étant `lastActiveDay`. Vide si rien ne
 * manque, ou si les gels en poche ne suffisent pas à couvrir tout le trou.
 */
export function freezeDaysToUse(lastActiveDay: string | null, winDay: string, pocket: number): string[] {
  if (!lastActiveDay) return []
  const premier = numeroDuJour(lastActiveDay) + 1
  const trou = numeroDuJour(winDay) - premier
  if (trou <= 0 || trou > Math.max(0, Math.floor(pocket) || 0)) return []
  return Array.from({ length: trou }, (_, index) => jourDuNumero(premier + index))
}

export type StreakSummary = {
  /** Série vivante aujourd'hui (0 si elle est cassée). */
  streak: number
  /** Série au moment de la dernière victoire. */
  streakAtLastWin: number
  best: number
  lastWin: string | null
}

/**
 * La série, d'après les victoires et les jours gelés (enregistrés).
 * Une série reste vivante aujourd'hui tant que les jours manqués depuis la
 * dernière journée active peuvent encore être couverts par les gels en poche :
 * ils le seront à la prochaine victoire.
 */
export function computeStreak(input: { winDays: readonly string[]; frozenDays: readonly string[]; today: string; pocket: number }): StreakSummary {
  const aujourdhui = numeroDuJour(input.today)
  const victoires = new Set(input.winDays.map(numeroDuJour).filter(n => n <= aujourdhui))
  const jours = [...new Set([...victoires, ...input.frozenDays.map(numeroDuJour).filter(n => n <= aujourdhui)])].sort((a, b) => a - b)

  let serie = 0
  let best = 0
  let veille: number | null = null
  let derniereVictoire: number | null = null
  for (const jour of jours) {
    if (veille !== null && jour - veille > 1) serie = 0
    if (victoires.has(jour)) {
      serie += 1
      best = Math.max(best, serie)
      derniereVictoire = jour
    }
    veille = jour
  }

  let streak = 0
  if (veille !== null) {
    const manques = aujourdhui - veille - 1
    streak = manques <= 0 || manques <= Math.max(0, Math.floor(input.pocket) || 0) ? serie : 0
  }
  return { streak, streakAtLastWin: derniereVictoire === null ? 0 : serie, best, lastWin: derniereVictoire === null ? null : jourDuNumero(derniereVictoire) }
}
