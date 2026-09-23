// ─────────────────────────────────────────────────────────────────────────────
// LES DEUX AIDES QUE PERSONNE NE VOIT.
//
// Relevé en base le 16/09/2026 (`public.experience_awards`, 30 derniers jours,
// parties terminées avec récompense) : en solo, l'indice sert dans 4 parties sur
// 41 et la relance du chevalet dans 2 sur 41 ; en multijoueur, sur 5 parties,
// ni l'un ni l'autre. Les deux boutons sont là, sous le pouce, et ils ne sont
// pas vus.
//
// Un joueur qui ne fait plus RIEN pendant vingt-cinq secondes cherche. C'est le
// moment de lui désigner l'aide — et seulement celle qui lui servirait : un
// bouton déjà consommé, ou que les règles refusent, ne se met pas en valeur
// pour se faire refuser au toucher. `canUseHint` et `canUseReroll` décident
// donc ici aussi : la mise en valeur ne peut pas promettre ce que le tour ne
// peut pas tenir.
//
// ── L'HORLOGE ───────────────────────────────────────────────────────────────
// Elle repart à chaque geste, et elle DÉMARRE au moment où le joueur peut agir.
// L'écran n'a qu'à la brancher sur `canAct`, ce qui donne les deux origines
// demandées sans avoir à les distinguer :
//   - en temps limité, le tour dure 45 s et `canAct` s'ouvre à son début : la
//     mise en valeur arrive à 25 s, il reste 20 s pour s'en servir ;
//   - en temps illimité, le tour dure 24 h et le joueur l'ouvre quand il veut.
//     `canAct` s'ouvre à l'ARRIVÉE sur la partie, jamais au début du tour — un
//     tour commencé la veille ferait clignoter le bouton dès l'ouverture.
//
// ── LA FIN DU TOUR L'EMPORTE ────────────────────────────────────────────────
// Dans les dix dernières secondes d'un tour limité, le chrono passe au rouge :
// c'est déjà une urgence. Un bouton qui respire à côté en ferait une deuxième,
// et le joueur a mieux à faire que choisir laquelle regarder. La mise en valeur
// s'efface (`turnUrgent`), et la barre de temps reste seule à parler.
// ─────────────────────────────────────────────────────────────────────────────

import { canUseHint, canUseReroll, type IndicesPris } from '../gameRules'

/**
 * Vingt-cinq secondes sans un geste (demande du propriétaire, 16/09/2026).
 *
 * Les tests de bout en bout ne peuvent pas attendre vingt-cinq secondes deux
 * fois par moteur. Le serveur de partie a déjà ses durées raccourcies par
 * l'environnement (`MOTMAN_TURN_DURATION_MS` et compagnie, voir
 * `playwright.config.ts`) ; celle-ci est côté client, donc elle passe par Vite.
 * Le raccourci n'est lu QUE derrière `VITE_MOTMAN_LOCAL_TEST_SERVER` : sur le
 * site publié et dans l'APK, le délai vaut vingt-cinq secondes, un point c'est
 * tout.
 */
function delaiConfigure(): number {
  if (import.meta.env.VITE_MOTMAN_LOCAL_TEST_SERVER !== 'true') return 25_000
  const raccourci = Number(import.meta.env.VITE_MOTMAN_IDLE_ASSIST_MS)
  return Number.isFinite(raccourci) && raccourci > 0 ? raccourci : 25_000
}

export const IDLE_ASSIST_DELAY_MS = delaiConfigure()

export type IdleAssistInput = {
  /** Le délai sans action est écoulé. */
  idle: boolean
  /** Le joueur peut poser une lettre maintenant : son tour, hors pause, hors alerte. */
  canAct: boolean
  /** Une révélation de coup est en cours à l'écran. */
  resolving: boolean
  /** Dernières secondes d'un tour en temps limité. */
  turnUrgent: boolean
  hint: {
    /** Combien d'indices ont déjà été pris dans cette partie (`hintUsed`). */
    used: IndicesPris
    /** Une demande d'indice est partie et n'est pas revenue. */
    requesting: boolean
  }
  reroll: {
    used: boolean
    requesting: boolean
    /** Lettres posées mais pas encore validées : la relance les emporterait. */
    pendingPlacements: number
    /** Un indice occupe déjà ce tour. */
    hintActive: boolean
  }
}

/** Les boutons à mettre en valeur — aucun, l'un, ou les deux. */
export type IdleAssistCue = { hint: boolean; reroll: boolean }

const AUCUNE: IdleAssistCue = { hint: false, reroll: false }

export function idleAssistCue(input: IdleAssistInput): IdleAssistCue {
  if (!input.idle || !input.canAct || input.resolving || input.turnUrgent) return AUCUNE
  return {
    hint: !input.hint.requesting && canUseHint(input.hint.used),
    reroll: !input.reroll.requesting && canUseReroll({
      alreadyUsed: input.reroll.used,
      pendingPlacements: input.reroll.pendingPlacements,
      hintActive: input.reroll.hintActive,
    }),
  }
}
