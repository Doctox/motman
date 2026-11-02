import { supabase, supabaseConfigured } from './supabaseClient'

// ─────────────────────────────────────────────────────────────────────────────
// LES PREMIERS PAS D'UN NOUVEAU (02/11/2026).
//
// 4 arrivants sur 6 sans partie repartaient en moins d'une minute, et rien ne
// disait à quel écran. Un compteur par jour et par étape, sans identifiant
// (migration 20261102100000) : le propriétaire le lit dans son pouls. Une fois
// par appareil, le souvenir restant dans le stockage local. Sans stockage, on ne
// compte rien plutôt que de compter dix fois le même.
//
// Sans attendre, sans erreur visible : un compteur ne doit jamais gêner le jeu.
// ─────────────────────────────────────────────────────────────────────────────

export type PremierPas = 'menu' | 'essai_passe' | 'essai_fini' | 'choix_defi' | 'choix_partie' | 'choix_plus_tard'

const CLE = 'motman-premiers-pas-v1'
const localTestServer = import.meta.env.VITE_MOTMAN_LOCAL_TEST_SERVER === 'true'

type Stockage = Pick<Storage, 'getItem' | 'setItem'>

function envoyerAuServeur(etape: PremierPas): void {
  if (localTestServer || !supabaseConfigured) return
  void supabase.rpc('note_first_step', { p_etape: etape }).then(() => undefined, () => undefined)
}

export function noterPremierPas(
  etape: PremierPas,
  stockage?: Stockage,
  envoyer: (etape: PremierPas) => void = envoyerAuServeur,
): void {
  try {
    const memoire = stockage ?? localStorage
    const dejaFaits = (memoire.getItem(CLE) ?? '').split(',')
    if (dejaFaits.includes(etape)) return
    memoire.setItem(CLE, [...dejaFaits.filter(Boolean), etape].join(','))
  } catch {
    return
  }
  envoyer(etape)
}
