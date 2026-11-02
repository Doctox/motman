import { useState } from 'react'
import { UserRoundCheck } from 'lucide-react'
import './menu-compte.css'

// ─────────────────────────────────────────────────────────────────────────────
// PROPOSER LE COMPTE, À L'ACCUEIL (02/11/2026).
//
// Le propriétaire : « je veux de la création de compte ». L'invitation vivait dans
// les réglages, le profil et l'onglet classé, jamais au moment où l'on a quelque
// chose à garder. La carte paraît dès la première partie finie, dit ce que le joueur
// a sur cet appareil, et ne menace de rien. « Plus tard » la range 3 jours.
// ─────────────────────────────────────────────────────────────────────────────

const CLE = 'motman-carte-compte-v1'
export const CARTE_COMPTE_REPOS_MS = 3 * 24 * 60 * 60 * 1_000

type Stockage = Pick<Storage, 'getItem' | 'setItem'>

/** Un invité qui a déjà joué, et qui n'a pas dit « Plus tard » il y a moins de 3 jours. */
export function carteCompteAMontrer(estInvite: boolean, xpTotale: number, maintenant = Date.now(), stockage?: Stockage): boolean {
  if (!estInvite || xpTotale <= 0) return false
  try {
    // Lu ici et non en valeur par défaut : un navigateur qui bloque le stockage
    // lève une erreur dès qu'on nomme `localStorage`, et l'accueil tombait avec.
    return Number((stockage ?? localStorage).getItem(CLE) ?? 0) <= maintenant
  } catch {
    return true
  }
}

export function reporterCarteCompte(maintenant = Date.now(), stockage?: Stockage): void {
  try {
    (stockage ?? localStorage).setItem(CLE, String(maintenant + CARTE_COMPTE_REPOS_MS))
  } catch {
    // Sans stockage, elle reviendra au prochain lancement.
  }
}

const nombreFrancais = new Intl.NumberFormat('fr-FR')

/** « Tes 1 240 plumes et ton niveau 3 » : ce qu'il a, avec ses chiffres. */
export function ceQuIlAGagne(plumes: number, niveau: number): string {
  return plumes > 0 ? `Tes ${nombreFrancais.format(plumes)} plumes et ton niveau ${niveau}` : `Ton niveau ${niveau}`
}

export function CarteCompte({ estInvite, xpTotale, plumes, niveau, creerCompte }: {
  estInvite: boolean
  xpTotale: number
  plumes: number
  niveau: number
  creerCompte: () => void
}) {
  const [rangee, setRangee] = useState(false)
  if (rangee || !carteCompteAMontrer(estInvite, xpTotale)) return null
  const pluriel = plumes > 0
  return <section className="mm-carte-compte" aria-label="Créer un compte">
    <UserRoundCheck aria-hidden="true" />
    <div>
      <strong>Garde ce que tu as gagné</strong>
      <p>{ceQuIlAGagne(plumes, niveau)} {pluriel ? 'sont' : 'est'} seulement sur cet appareil. Avec un compte, tu {pluriel ? 'les' : 'le'} retrouves partout.</p>
      <div className="mm-carte-compte-actions">
        <button type="button" className="principal" onClick={creerCompte}>Créer mon compte</button>
        <button type="button" onClick={() => { reporterCarteCompte(); setRangee(true) }}>Plus tard</button>
      </div>
    </div>
  </section>
}
