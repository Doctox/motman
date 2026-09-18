// ─────────────────────────────────────────────────────────────────────────────
// LES NOUVEAUTÉS — noter dans la journée, annoncer à 10 h et à 18 h.
//
// Deux gestes séparés, voulus ainsi par le propriétaire le 18/09/2026 :
//
//   NOTER. À chaque commit qui compte pour le joueur, un RAPPORT d'une ligne
//   s'ajoute à `nouveautes.rapports.json` (`npm run rapport -- "titre" "texte"`,
//   ou tout seul à l'intégration d'un lot). On pousse, on commite, on vit sa vie.
//
//   ANNONCER. À 10 h et à 18 h, heure de Paris, l'app rassemble les rapports
//   déposés depuis le rendez-vous précédent en UN SEUL message de nouveauté, et
//   la pastille s'allume. Cinq thèmes entrés dans la matinée font un message,
//   pas cinq. Deux rendez-vous plutôt qu'un (le propriétaire, même jour) : une
//   chose faite à 8 h n'a pas à attendre le soir.
//
//     déposé avant 10 h          → paraît à 10 h
//     entre 10 h et 18 h         → paraît à 18 h
//     après 18 h                 → paraît le LENDEMAIN à 10 h
//
// Avant son rendez-vous, un rapport est invisible : il reste le temps de relire
// ou de corriger son texte avant qu'il parte aux joueurs.
//
// Tout se passe dans l'app : ni serveur ni tâche planifiée. L'heure vient de
// l'horloge du serveur (`serverNow`), comme pour le défi du jour, pour qu'un
// téléphone mal réglé ne voie pas le message en avance.
//
// LA PISTE DE PASTILLES : roue crantée → enveloppe du menu → message non lu. C'est
// en OUVRANT le message qu'il passe lu, pas en survolant la liste.
//
// On n'écrit que ce qu'un joueur REMARQUERAIT : un thème qui arrive, un lot de
// grilles, une gêne qui disparaît. Le tutoriel garde son rôle pour les
// mécaniques nouvelles — ici on informe, là-bas on apprend à jouer.
// ─────────────────────────────────────────────────────────────────────────────

import { useSyncExternalStore } from 'react'
import rapportsData from './nouveautes.rapports.json'
import { creneauDePublication, momentParis } from './nouveautesCreneaux'
import { serverNow } from './serverClock'
import { completedTutorialVersion } from './tutorialProgress'

export type Rapport = {
  /** Heure de PARIS du dépôt, `AAAA-MM-JJTHH:MM`. C'est elle qui décide du message. */
  ajoute: string
  titre: string
  /** Une ou deux phrases. Le joueur lit ça entre deux parties. */
  texte: string
}

/** Un message de nouveauté : les rapports d'un créneau, publiés ensemble. */
export type Nouveaute = {
  /** `maj-AAAA-MM-JJ-HH` : stable, c'est lui que retient l'état « lu ». */
  id: string
  /** Le jour de publication, `AAAA-MM-JJ`. */
  date: string
  /** L'heure de publication, l'une de `HEURES_DE_PUBLICATION`. */
  heure: number
  /** Dans l'ordre de dépôt. */
  rapports: Rapport[]
}

export const RAPPORTS: readonly Rapport[] = rapportsData as Rapport[]

// La règle des rendez-vous vit dans src/nouveautesCreneaux.ts, SANS IMPORT, pour
// que le script qui dépose les rapports la lise telle quelle.
export { creneauDePublication, HEURES_DE_PUBLICATION, horodatageParis, momentParis } from './nouveautesCreneaux'

/** Les messages déjà parus à cet instant, le plus récent en haut. */
export function nouveautesPubliees(rapports: readonly Rapport[] = RAPPORTS, maintenantMs: number = serverNow()): Nouveaute[] {
  const maintenant = momentParis(maintenantMs)
  const paru = (c: { date: string; heure: number }) =>
    c.date < maintenant.date || (c.date === maintenant.date && maintenant.heure >= c.heure)
  // La clé `AAAA-MM-JJ-HH` se trie comme le temps : deux chiffres pour l'heure.
  const parCreneau = new Map<string, { date: string; heure: number; rapports: Rapport[] }>()
  for (const rapport of [...rapports].sort((a, b) => a.ajoute.localeCompare(b.ajoute))) {
    const creneau = creneauDePublication(rapport.ajoute)
    if (!paru(creneau)) continue
    const cle = `${creneau.date}-${String(creneau.heure).padStart(2, '0')}`
    const courant = parCreneau.get(cle) ?? { ...creneau, rapports: [] }
    courant.rapports.push(rapport)
    parCreneau.set(cle, courant)
  }
  return [...parCreneau.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([cle, creneau]) => ({ id: `maj-${cle}`, date: creneau.date, heure: creneau.heure, rapports: creneau.rapports }))
}

export const NOUVEAUTES_STORAGE_KEY = 'motman-nouveautes-lues'

/**
 * Les messages lus, lus dans le stockage.
 *
 * PREMIÈRE OUVERTURE (aucune clé) : un joueur tout neuf n'a rien à « rattraper »
 * — le tutoriel l'accueille. Tout ce qui est DÉJÀ paru passe donc lu d'office ;
 * seuls les messages publiés après son arrivée s'allumeront. Un HABITUÉ, lui, a
 * déjà fini le tutoriel : il voit ce qu'il n'a pas ouvert. L'état initial est
 * ÉCRIT aussitôt, pour que la règle ne s'évalue qu'une fois.
 */
export function lireEntreesLues(
  storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage,
  publiees: readonly Nouveaute[] = nouveautesPubliees(),
  dejaJoue: () => boolean = () => completedTutorialVersion() > 0,
): Set<string> {
  try {
    const brut = storage.getItem(NOUVEAUTES_STORAGE_KEY)
    if (brut !== null) {
      const valeur = JSON.parse(brut) as unknown
      return new Set(Array.isArray(valeur) ? valeur.filter((id): id is string => typeof id === 'string') : [])
    }
    const initial = dejaJoue() ? new Set<string>() : new Set(publiees.map(entree => entree.id))
    storage.setItem(NOUVEAUTES_STORAGE_KEY, JSON.stringify([...initial]))
    return initial
  } catch {
    // Stockage indisponible : aucune pastille plutôt qu'une qu'on ne pourrait
    // jamais éteindre.
    return new Set(publiees.map(entree => entree.id))
  }
}

/** Les messages parus et pas encore ouverts. */
export function nouveautesNonLues(lues: ReadonlySet<string>, publiees: readonly Nouveaute[]): Nouveaute[] {
  return publiees.filter(entree => !lues.has(entree.id))
}

// ── L'état partagé : la roue, l'enveloppe et la liste le lisent ensemble ──────
// Un seul instantané, remplacé à chaque changement : `useSyncExternalStore`
// compare les références.

type Etat = { lues: Set<string>; publiees: Nouveaute[] }

const abonnes = new Set<() => void>()
let etatCourant: Etat | null = null
let minuterie: ReturnType<typeof setInterval> | null = null

function signature(publiees: readonly Nouveaute[]): string {
  return publiees.map(entree => `${entree.id}:${entree.rapports.length}`).join('|')
}

function etat(): Etat {
  if (!etatCourant) {
    const publiees = nouveautesPubliees()
    etatCourant = { publiees, lues: lireEntreesLues(localStorage, publiees) }
  }
  return etatCourant
}

function prevenir(): void {
  abonnes.forEach(rappel => rappel())
}

/**
 * 18 h peut sonner pendant que l'app est ouverte : on regarde chaque minute si
 * un message vient de paraître, pour que la pastille s'allume sans recharger.
 */
function surveillerLHeure(): void {
  if (minuterie || typeof window === 'undefined') return
  minuterie = setInterval(() => {
    const courant = etat()
    const publiees = nouveautesPubliees()
    if (signature(publiees) === signature(courant.publiees)) return
    etatCourant = { ...courant, publiees }
    prevenir()
  }, 60_000)
}

export function marquerNouveauteLue(id: string, storage: Pick<Storage, 'setItem'> = localStorage): void {
  const courant = etat()
  if (courant.lues.has(id)) return
  const lues = new Set([...courant.lues, id])
  etatCourant = { ...courant, lues }
  try {
    storage.setItem(NOUVEAUTES_STORAGE_KEY, JSON.stringify([...lues]))
  } catch {
    // Retenu pour la session, faute de pouvoir l'écrire.
  }
  prevenir()
}

function sAbonner(rappel: () => void): () => void {
  abonnes.add(rappel)
  surveillerLHeure()
  return () => {
    abonnes.delete(rappel)
    if (!abonnes.size && minuterie) {
      clearInterval(minuterie)
      minuterie = null
    }
  }
}

/** Les messages parus et l'état « lu », mis à jour dès qu'on en ouvre un — ou qu'il est 18 h. */
export function useNouveautes(): Etat {
  return useSyncExternalStore(sAbonner, etat, etat)
}

/** Vrai tant qu'au moins un message paru n'a pas été ouvert : c'est la pastille. */
export function useNouveauteEnAttente(): boolean {
  const { lues, publiees } = useNouveautes()
  return nouveautesNonLues(lues, publiees).length > 0
}

/** Pour les bancs d'essai : oublie l'état chargé. */
export function reinitialiserNouveautesPourTest(): void {
  etatCourant = null
}
