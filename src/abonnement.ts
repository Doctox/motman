// ─────────────────────────────────────────────────────────────────────────────
// MOTMAN+ — ses règles et ce qu'il faut pour l'afficher.
//
// Tout le monde le voit avant de pouvoir le prendre (décision du propriétaire,
// 05/11/2026 : « ça peut donner envie, on montre qu'on a du contenu en cours »).
// Il ne fonctionne que sur son compte, le temps de le tester. Il ouvre les grilles
// de tous les thèmes, la partie au calme, les emotes en partie et la couleur du
// pseudo (huit couleurs ou le néon).
//
// Ce fichier ne décide d'aucun droit : `admin` ne sert ici qu'à afficher, et le
// serveur revérifie le rôle en base à chaque action réservée.
// ─────────────────────────────────────────────────────────────────────────────

import calendrier from './data/runtime.daily.themes.json'
import { PARTIES_OFFERTES_A_UN_AMI, type CouleurPseudoId } from './reglesPlus'

export { PARTIES_OFFERTES_A_UN_AMI, type CouleurPseudoId }

/** Le nom affiché partout. Le changer ici le change dans toute l'appli. */
export const NOM_ABONNEMENT = 'MotMan+'

const SERVEUR_DE_TEST = import.meta.env.VITE_MOTMAN_LOCAL_TEST_SERVER === 'true'

export type EtatAbonnement = {
  actif: boolean
  couleurPseudo: CouleurPseudoId | null
}

export const SANS_ABONNEMENT: EtatAbonnement = { actif: false, couleurPseudo: null }

// ── Les couleurs du pseudo ──────────────────────────────────────────────────
// Huit teintes, chacune avec sa version pour le thème sombre. Toutes passent
// 4,5:1 sur les fonds des cartes, clairs et sombres (abonnement.test.ts) : un
// pseudo jaune pâle illisible n'existera pas.

export type CouleurPseudo = { id: Exclude<CouleurPseudoId, 'arc-en-ciel'>; nom: string; clair: string; sombre: string }

export const COULEURS_PSEUDO: readonly CouleurPseudo[] = [
  { id: 'emeraude', nom: 'Émeraude', clair: '#0b6b4b', sombre: '#5fd3a2' },
  { id: 'ocean', nom: 'Océan', clair: '#1b5aa0', sombre: '#86b8f2' },
  { id: 'indigo', nom: 'Indigo', clair: '#4338ca', sombre: '#a9b4fc' },
  { id: 'prune', nom: 'Prune', clair: '#7a3a8a', sombre: '#d6a6e2' },
  { id: 'framboise', nom: 'Framboise', clair: '#a8234f', sombre: '#f494b8' },
  { id: 'ambre', nom: 'Ambre', clair: '#8f5200', sombre: '#f2b45a' },
  { id: 'turquoise', nom: 'Turquoise', clair: '#086878', sombre: '#66d1e0' },
  { id: 'ardoise', nom: 'Ardoise', clair: '#3c4a63', sombre: '#b3bfd6' },
]

// Le joueur lit « Néon » depuis le 05/11/2026 (demande du propriétaire) ; l'effet reste
// le même, et l'identifiant garde son nom d'origine.
export const ARC_EN_CIEL = { id: 'arc-en-ciel' as const, nom: 'Néon' }

/** La couleur réellement portée : celle choisie, tant que l'abonnement court. */
export function couleurPortee(etat: EtatAbonnement): CouleurPseudoId | null {
  return etat.actif ? etat.couleurPseudo : null
}

// ── Le rythme d'une partie à thème ───────────────────────────────────────────
// Le joueur choisit (décision du 16/10/2026, « on peut laisser le choix ») :
// avec chrono, la partie rapporte comme une partie normale ; au calme, sans
// chrono ni récompense, comme la partie au calme de la carte Normal (A9).

export type RythmeTheme = 'chrono' | 'calme'

const CLE_RYTHME = 'motman-rythme-theme'

/** Le dernier rythme choisi par ce joueur sur cet appareil ; au calme la première fois. */
export function lireRythmeTheme(): RythmeTheme {
  try { return localStorage.getItem(CLE_RYTHME) === 'chrono' ? 'chrono' : 'calme' } catch { return 'calme' }
}

export function retenirRythmeTheme(rythme: RythmeTheme): void {
  try { localStorage.setItem(CLE_RYTHME, rythme) } catch { /* sans conséquence */ }
}

// ── Où l'on en est, pour les écrans ─────────────────────────────────────────

export type ThemeAbonnement = { nom: string; grilles: number; jouees: number }

const CLE_TEST = 'motman-abonnement-test'

/**
 * L'état affiché : ouvert sur le compte du propriétaire (`identity.admin`), fermé
 * pour tous les autres. La couleur vient du compte (`couleurDuCompte`), et suit donc
 * d'un appareil à l'autre. Le serveur de test local, lui, se règle depuis la console :
 * `localStorage.setItem('motman-abonnement-test', JSON.stringify({ actif: true, couleurPseudo: 'ocean' }))`.
 */
export function lireAbonnement(proprietaire = false, couleurDuCompte?: CouleurPseudoId | null): EtatAbonnement {
  if (!SERVEUR_DE_TEST && !proprietaire) return SANS_ABONNEMENT
  const base = proprietaire ? { ...SANS_ABONNEMENT, actif: true, couleurPseudo: couleurDuCompte ?? null } : SANS_ABONNEMENT
  if (couleurDuCompte !== undefined && !SERVEUR_DE_TEST) return base
  try {
    const brut = localStorage.getItem(CLE_TEST)
    return brut ? { ...base, ...(JSON.parse(brut) as Partial<EtatAbonnement>) } : base
  } catch {
    return base
  }
}

export function enregistrerCouleur(couleur: CouleurPseudoId | null, proprietaire = false): EtatAbonnement {
  const etat = { ...lireAbonnement(proprietaire), couleurPseudo: couleur }
  // Le compte la garde (Menu.tsx) ; ici, seulement le serveur de test local.
  if (SERVEUR_DE_TEST) try { localStorage.setItem(CLE_TEST, JSON.stringify(etat)) } catch { /* retenue pour cette session */ }
  return etat
}

/** Les thèmes du calendrier du défi, en vitrine. Les nombres viennent du serveur (`chargerThemesPlus`). */
export const THEMES: readonly ThemeAbonnement[] = [...new Set(Object.values((calendrier as { themes: Record<string, string> }).themes))]
  .map(nom => ({ nom, grilles: 0, jouees: 0 }))
