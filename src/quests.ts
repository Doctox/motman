// ─────────────────────────────────────────────────────────────────────────────
// LES QUÊTES — barème et rotation, SOURCE UNIQUE.
//
// Décidé par le propriétaire le 16/09/2026 : trois quêtes par jour, toutes
// réalisables DANS UNE SEULE PARTIE, plus une quête de la semaine. La
// récompense n'est pas versée toute seule : le joueur touche « Récupérer », et
// c'est ce geste qui paie (60 plumes et 30 XP par quête du jour, un gel de série
// pour la semaine).
//
// Ce fichier est minuscule et SANS DÉPENDANCE, comme `dailyMilestones.ts` : il
// est importé par le client ET par les edge functions (`match-api` compte,
// `account-api` paie), qui tournent dans un worker Deno. Le barème est donc écrit
// UNE fois — un écart entre ce que l'écran annonce et ce que le serveur verse est
// exactement le genre de défaut qui coûte la confiance.
//
// La base, elle, ne connaît ni les cibles ni les montants : elle accumule des
// COMPTEURS et enregistre des récupérations. C'est le serveur qui décide qu'une
// quête est finie, en lisant ce fichier.
// ─────────────────────────────────────────────────────────────────────────────

/** Ce qu'une quête compte. Un compteur est accumulé sur la journée (ou la semaine). */
export type QuestCounter = 'lettres' | 'chevalet' | 'partie' | 'sans-indice' | 'mots' | 'images' | 'defi'

export type Quest = {
  id: string
  counter: QuestCounter
  target: number
  title: string
  hint: string
}

export const DAILY_QUEST_PLUMES = 60
export const DAILY_QUEST_XP = 30
export const DAILY_QUEST_COUNT = 3
/** Gels offerts par la quête de la semaine. Rendus en plumes si la poche est pleine (3). */
export const WEEKLY_QUEST_FREEZES = 1
export const WEEKLY_QUEST_PLUMES_IF_FULL = 500

/**
 * Le vivier du jour. Chaque quête doit pouvoir être finie en UNE partie : c'est
 * la règle posée par le propriétaire, pour que le défi du jour suffise à tout
 * boucler. D'où l'absence de « gagne », de « joue 3 parties », et de toute quête
 * qui attend un autre joueur : à 7 joueurs par jour, elle serait infinissable.
 */
export const QUEST_POOL: readonly Quest[] = [
  { id: 'lettres-12', counter: 'lettres', target: 12, title: 'Poser 12 lettres justes', hint: 'Dans n’importe quelle partie.' },
  { id: 'chevalet-1', counter: 'chevalet', target: 1, title: 'Réussir un chevalet complet', hint: 'Les 5 lettres justes au même tour.' },
  { id: 'partie-1', counter: 'partie', target: 1, title: 'Terminer une partie', hint: 'Gagnée ou perdue, elle compte.' },
  { id: 'sans-indice-1', counter: 'sans-indice', target: 1, title: 'Finir une partie sans indice', hint: 'Sans toucher au bouton Indice.' },
  { id: 'mots-5', counter: 'mots', target: 5, title: 'Compléter 5 mots', hint: 'Un mot est à vous si vous posez sa dernière lettre.' },
  { id: 'images-3', counter: 'images', target: 3, title: 'Compléter 3 mots en image', hint: 'Ceux dont la définition est un dessin.' },
]

/** La quête de la semaine, du lundi au dimanche. */
export const WEEKLY_QUEST: Quest = {
  id: 'defi-4',
  counter: 'defi',
  target: 4,
  title: 'Jouer le défi du jour 4 fois',
  hint: 'Sur la semaine, du lundi au dimanche.',
}

/** Empreinte stable d'une chaîne — même valeur partout, sans dépendance. */
function empreinte(texte: string): number {
  let valeur = 2_166_136_261
  for (let i = 0; i < texte.length; i += 1) {
    valeur ^= texte.charCodeAt(i)
    valeur = Math.imul(valeur, 16_777_619) >>> 0
  }
  return valeur >>> 0
}

/**
 * Les trois quêtes du jour — les MÊMES pour tout le monde, tirées de la clé de
 * jour (`dailyDate.ts`, Europe/Paris). Pas de tirage par joueur : tout le monde
 * a les mêmes, comme la grille du jour, et on peut en parler entre amis.
 */
export function dailyQuests(dayKey: string): Quest[] {
  const restantes = [...QUEST_POOL]
  const choisies: Quest[] = []
  for (let rang = 0; rang < DAILY_QUEST_COUNT && restantes.length > 0; rang += 1) {
    choisies.push(...restantes.splice(empreinte(`${dayKey}:${rang}`) % restantes.length, 1))
  }
  return choisies
}

/**
 * Clé de semaine ISO (lundi → dimanche) d'une clé de jour `YYYY-MM-DD`, par
 * exemple `2026-W38`. Calculée sur la clé de jour de Paris, jamais sur l'horloge
 * locale : deux joueurs dans deux fuseaux doivent voir la même semaine.
 */
export function weekKey(dayKey: string): string {
  const [annee, mois, jour] = dayKey.split('-').map(Number)
  const date = new Date(Date.UTC(annee, mois - 1, jour))
  // Jeudi de la semaine ISO : c'est lui qui donne l'année et le numéro.
  const jourIso = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - jourIso + 3)
  const premierJeudi = new Date(Date.UTC(date.getUTCFullYear(), 0, 4))
  const decalage = (premierJeudi.getUTCDay() + 6) % 7
  premierJeudi.setUTCDate(premierJeudi.getUTCDate() - decalage + 3)
  const semaine = 1 + Math.round((date.getTime() - premierJeudi.getTime()) / (7 * 86_400_000))
  return `${date.getUTCFullYear()}-W${String(semaine).padStart(2, '0')}`
}

export type QuestCounters = Partial<Record<QuestCounter, number>>

export type QuestView = {
  id: string
  /** Ce que la quête compte : l'écran en tire son icône. */
  counter: QuestCounter
  title: string
  hint: string
  target: number
  progress: number
  done: boolean
  claimed: boolean
}

function vue(quest: Quest, compteurs: QuestCounters, recuperees: readonly string[]): QuestView {
  const progress = Math.max(0, Math.min(quest.target, Math.floor(compteurs[quest.counter] ?? 0)))
  return {
    id: quest.id,
    counter: quest.counter,
    title: quest.title,
    hint: quest.hint,
    target: quest.target,
    progress,
    done: progress >= quest.target,
    claimed: recuperees.includes(quest.id),
  }
}

/** L'état affiché : les trois du jour, puis celle de la semaine. */
export function questBoard({ dayKey, dayCounters, weekCounters, dayClaimed, weekClaimed }: {
  dayKey: string
  dayCounters: QuestCounters
  weekCounters: QuestCounters
  dayClaimed: readonly string[]
  weekClaimed: readonly string[]
}): { day: QuestView[]; week: QuestView } {
  return {
    day: dailyQuests(dayKey).map(quest => vue(quest, dayCounters, dayClaimed)),
    week: vue(WEEKLY_QUEST, weekCounters, weekClaimed),
  }
}

/** Une récompense attend : c'est ce qui allume la pastille du bouton Quêtes. */
export function hasClaimableQuest(board: { day: QuestView[]; week: QuestView }): boolean {
  return [...board.day, board.week].some(quest => quest.done && !quest.claimed)
}

export type QuestReward = { plumes: number; xp: number; freezes: number }

/**
 * Ce que paie une récupération. Le serveur lit CE barème avant de créditer :
 * le client ne dit jamais combien il reçoit.
 */
export function questReward(scope: 'day' | 'week', pocketFreezes: number): QuestReward {
  if (scope === 'day') return { plumes: DAILY_QUEST_PLUMES, xp: DAILY_QUEST_XP, freezes: 0 }
  // Poche pleine : le gel serait perdu, il devient des plumes.
  return pocketFreezes >= 3
    ? { plumes: WEEKLY_QUEST_PLUMES_IF_FULL, xp: 0, freezes: 0 }
    : { plumes: 0, xp: 0, freezes: WEEKLY_QUEST_FREEZES }
}
