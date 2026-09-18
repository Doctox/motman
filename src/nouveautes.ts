// ─────────────────────────────────────────────────────────────────────────────
// LES NOUVEAUTÉS — ce qui a changé, dit au joueur.
//
// Une courte liste datée, dans le menu (roue crantée → « Nouveautés »). Une
// PISTE DE PASTILLES y mène : sur la roue crantée tant qu'une entrée n'est pas
// lue, puis sur la ligne « Nouveautés », puis sur l'entrée elle-même. C'est en
// ouvrant CETTE entrée qu'elle passe lue — pas en survolant la liste. Voulu
// ainsi par le propriétaire le 18/09/2026.
//
// LES ENTRÉES S'ÉCRIVENT À LA MAIN, ICI. Surtout pas une par déploiement : avec
// la mise à jour embarquée, le jeu change plusieurs fois par jour sans que le
// joueur ait rien à apprendre, et une pastille qui clignote à chaque fois ne
// serait plus lue par personne. On n'écrit que ce qu'un joueur REMARQUERAIT :
// un thème qui arrive, un gros lot de grilles, une gêne qui disparaît.
//
// Le tutoriel garde son rôle : quand une MÉCANIQUE nouvelle demande d'être
// expliquée, c'est lui qu'on rouvre (`FIRST_RUN_TUTORIAL_VERSION`). Ici, on
// informe ; là-bas, on apprend à jouer.
//
// Tout ce fichier part par la mise à jour embarquée : ajouter une entrée ne
// demande aucun APK.
// ─────────────────────────────────────────────────────────────────────────────

import { useSyncExternalStore } from 'react'
import { completedTutorialVersion } from './tutorialProgress'

export type Nouveaute = {
  /** Stable, jamais réutilisé : c'est lui que retient l'état « lu ». */
  id: string
  /** `AAAA-MM-JJ`, pour l'affichage. */
  date: string
  titre: string
  /** Une ou deux phrases. Le joueur lit ça entre deux parties. */
  texte: string
}

/** La plus récente EN HAUT. Ajouter en tête, ne jamais changer un `id`. */
export const NOUVEAUTES: readonly Nouveaute[] = [
  {
    id: '2026-09-18-definitions-entieres',
    date: '2026-09-18',
    titre: 'Les définitions s’affichent en entier',
    texte: 'Plus de « Elle fait la… » ou « Côté droit de la… » : chaque définition tient maintenant entière dans sa case.',
  },
  {
    id: '2026-09-18-trente-deux-grilles',
    date: '2026-09-18',
    titre: '32 nouvelles grilles',
    texte: 'Les parties normales passent de 79 à 111 grilles : vous tomberez beaucoup moins souvent deux fois sur la même.',
  },
  {
    id: '2026-09-17-grandes-polices',
    date: '2026-09-17',
    titre: 'Un affichage net avec une grande police',
    texte: 'Si votre téléphone agrandit le texte, MotMan garde désormais sa mise en page : lettres, chrono et boutons restent à leur place.',
  },
]

export const NOUVEAUTES_STORAGE_KEY = 'motman-nouveautes-lues'

/**
 * Les entrées lues, lues dans le stockage.
 *
 * PREMIÈRE OUVERTURE (aucune clé) : un joueur tout neuf n'a rien à « rattraper »
 * — le tutoriel l'accueille, et une pastille sur des nouveautés antérieures à
 * son arrivée ne voudrait rien dire pour lui. Tout ce qui existe passe donc lu
 * d'office. Un HABITUÉ, lui, a déjà fini le tutoriel : il voit les entrées non
 * lues, c'est tout l'objet de la section. C'est le tutoriel qui fait la
 * différence entre les deux, parce que c'est la seule trace durable d'un
 * passage antérieur dans ce navigateur.
 *
 * L'état initial est ÉCRIT aussitôt : la règle ne s'évalue qu'une fois. Sinon un
 * joueur neuf qui termine ensuite le tutoriel deviendrait « habitué » et verrait
 * toutes les entrées se rallumer.
 */
export function lireEntreesLues(
  storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage,
  liste: readonly Nouveaute[] = NOUVEAUTES,
  dejaJoue: () => boolean = () => completedTutorialVersion() > 0,
): Set<string> {
  try {
    const brut = storage.getItem(NOUVEAUTES_STORAGE_KEY)
    if (brut !== null) {
      const valeur = JSON.parse(brut) as unknown
      return new Set(Array.isArray(valeur) ? valeur.filter((id): id is string => typeof id === 'string') : [])
    }
    const initial = dejaJoue() ? new Set<string>() : new Set(liste.map(entree => entree.id))
    storage.setItem(NOUVEAUTES_STORAGE_KEY, JSON.stringify([...initial]))
    return initial
  } catch {
    // Stockage indisponible (navigation privée, bac à sable) : aucune pastille
    // plutôt qu'une pastille qu'on ne pourrait jamais éteindre.
    return new Set(liste.map(entree => entree.id))
  }
}

/** Les entrées pas encore ouvertes, dans l'ordre de la liste. */
export function nouveautesNonLues(lues: ReadonlySet<string>, liste: readonly Nouveaute[] = NOUVEAUTES): Nouveaute[] {
  return liste.filter(entree => !lues.has(entree.id))
}

// ── L'état partagé : la roue, la ligne du menu et la liste le lisent ensemble ──
// Ouvrir une entrée doit éteindre les trois pastilles d'un coup. Un magasin
// minuscule plutôt qu'un état passé de composant en composant.

const abonnes = new Set<() => void>()
let lues: Set<string> | null = null

function etat(): Set<string> {
  lues ??= lireEntreesLues()
  return lues
}

export function marquerNouveauteLue(id: string, storage: Pick<Storage, 'setItem'> = localStorage): void {
  const courant = etat()
  if (courant.has(id)) return
  // Un NOUVEL ensemble : `useSyncExternalStore` compare les références.
  lues = new Set([...courant, id])
  try {
    storage.setItem(NOUVEAUTES_STORAGE_KEY, JSON.stringify([...lues]))
  } catch {
    // Retenu pour la session, faute de pouvoir l'écrire.
  }
  abonnes.forEach(prevenir => prevenir())
}

function sAbonner(prevenir: () => void): () => void {
  abonnes.add(prevenir)
  return () => abonnes.delete(prevenir)
}

/** Les entrées lues, qui se mettent à jour dès qu'on en ouvre une. */
export function useNouveautesLues(): ReadonlySet<string> {
  return useSyncExternalStore(sAbonner, etat, etat)
}

/** Vrai tant qu'au moins une entrée n'a pas été ouverte : c'est la pastille. */
export function useNouveauteEnAttente(): boolean {
  return nouveautesNonLues(useNouveautesLues()).length > 0
}

/** Pour les bancs d'essai : oublie l'état chargé. */
export function reinitialiserNouveautesPourTest(): void {
  lues = null
}
