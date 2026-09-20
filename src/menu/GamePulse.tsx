import { useEffect, useState } from 'react'
import { Activity, RefreshCw } from 'lucide-react'
import { loadGamePulse, type GamePulse } from '../matches'
import './menu-pulse.css'

// ─────────────────────────────────────────────────────────────────────────────
// LE POULS DU JEU — VISIBLE DU SEUL PROPRIÉTAIRE (20/09/2026)
//
// Demandé le jour de la sortie : savoir d'un coup d'œil combien de joueurs sont
// là, sans ouvrir le tableau de bord Supabase ni écrire du SQL.
//
// DEUX GARDE-FOUS. Le drapeau `identity.admin` ne fait qu'afficher ou taire
// cette carte ; l'action `game-pulse` revérifie le rôle EN BASE à chaque appel,
// et répond 403 à tout le monde d'autre. Et la réponse ne contient QUE des
// nombres : pas un pseudo, pas un identifiant — savoir combien jouent n'oblige
// pas à savoir qui.
//
// Le jour est celui de Paris : un compteur qui basculerait à minuit UTC
// afficherait « 0 joueur » à deux heures du matin, en pleine soirée de jeu.
// ─────────────────────────────────────────────────────────────────────────────

export function GamePulse() {
  const [pouls, setPouls] = useState<GamePulse | null>(null)
  const [erreur, setErreur] = useState(false)
  const [tour, setTour] = useState(0)

  useEffect(() => {
    let vivant = true
    loadGamePulse()
      .then(valeur => { if (vivant) { setPouls(valeur); setErreur(false) } })
      .catch(() => { if (vivant) setErreur(true) })
    return () => { vivant = false }
  }, [tour])

  if (erreur) return null

  return (
    <section className="mm-pulse" aria-label="Audience du jour">
      <header>
        <Activity aria-hidden="true" />
        <strong>Aujourd’hui</strong>
        <button type="button" aria-label="Rafraîchir les chiffres" onClick={() => setTour(valeur => valeur + 1)}>
          <RefreshCw aria-hidden="true" />
        </button>
      </header>
      {pouls ? <>
        <div className="mm-pulse-chiffres">
          <span><b>{pouls.enLigne}</b><small>en ligne</small></span>
          <span><b>{pouls.actifsDuJour}</b><small>joueurs du jour</small></span>
          <span><b>{pouls.partiesDuJour}</b><small>parties</small></span>
          <span><b>{pouls.defisDuJour}</b><small>défis joués</small></span>
        </div>
        <p className="mm-pulse-pied">
          {pouls.actifsSeptJours} sur 7 jours · {pouls.comptes} comptes · {pouls.nouveauxDuJour} nouveau{pouls.nouveauxDuJour > 1 ? 'x' : ''} aujourd’hui
          {pouls.classeesSeptJours > 0 ? ` · ${pouls.classeesSeptJours} parties classées cette semaine` : ' · aucune partie classée cette semaine'}
        </p>
      </> : <p className="mm-pulse-pied">Lecture des chiffres…</p>}
    </section>
  )
}
