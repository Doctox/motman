import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Users } from 'lucide-react'
import { loadOnlinePlayers, type OnlineActivity, type OnlinePlayer } from '../matches'
import { useDialogFocus } from '../useDialogFocus'
import './menu-online.css'

// ─────────────────────────────────────────────────────────────────────────────
// QUI EST EN LIGNE, ET CE QU'IL FAIT (11/10/2026)
//
// Derrière « En ligne » dans le pouls du jeu, à la demande du propriétaire :
// chaque joueur là maintenant, lui non compté, et ce qu'il fait d'après le
// SERVEUR — la partie en cours (mode, adversaire, tour, score), la file où il
// attend, ou le menu. Le serveur revérifie le rôle admin à chaque lecture.
// ─────────────────────────────────────────────────────────────────────────────

const MODES: Record<string, string> = { ranked: 'Classée', normal: 'Partie normale', friend: 'Entre amis', solo: 'Partie solo' }

/** « 45 s », « 2 min 05 ». */
export function dureeEnClair(secondes: number): string {
  if (secondes < 60) return `${secondes} s`
  const minutes = Math.floor(secondes / 60)
  const reste = secondes % 60
  return reste ? `${minutes} min ${String(reste).padStart(2, '0')}` : `${minutes} min`
}

/** La ligne principale : ce qu'il fait. */
export function activiteEnClair(activite: OnlineActivity): string {
  switch (activite.quoi) {
    case 'partie': {
      if (activite.defi) return activite.defi.theme ? `Défi du jour « ${activite.defi.theme} »` : 'Défi du jour'
      const mode = MODES[activite.mode] ?? 'Partie'
      const adversaire = activite.adversaire
      if (!adversaire) return mode
      if (adversaire.genre === 'fantome') return `${mode} contre ton fantôme`
      if (adversaire.genre === 'ombre') return `${mode} contre ${adversaire.nom} (ombre)`
      return `${mode} contre ${adversaire.nom}${adversaire.genre === 'bot' ? ' (bot)' : ''}`
    }
    case 'confirmation': return 'Adversaire classé trouvé, confirmation en cours'
    case 'recherche': return `Cherche une ${activite.file === 'classee' ? 'classée' : 'partie normale'} depuis ${dureeEnClair(activite.depuisS)}`
    case 'ecran-de-partie': return 'Sur un écran de partie'
    case 'menu': return 'Dans le menu'
  }
}

/** La ligne de détail d'une partie : tour, score, à qui de jouer. */
export function detailDePartie(activite: OnlineActivity): string | null {
  if (activite.quoi !== 'partie') return null
  const score = activite.defi ? `${activite.score} pts` : `${activite.score} à ${activite.scoreAdverse}`
  return `Tour ${activite.tour} · ${score}${activite.defi ? '' : activite.aSonTour ? ' · à lui de jouer' : ''}`
}

export function OnlinePlayersPanel({ fermer, charger = loadOnlinePlayers }: {
  fermer: () => void
  charger?: () => Promise<OnlinePlayer[]>
}) {
  const dialogRef = useDialogFocus<HTMLDivElement>(fermer)
  const [joueurs, setJoueurs] = useState<OnlinePlayer[] | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [tour, setTour] = useState(0)
  const rafraichir = useCallback(() => setTour(valeur => valeur + 1), [])

  useEffect(() => {
    let vivant = true
    setErreur(null)
    charger()
      .then(liste => { if (vivant) setJoueurs(liste) })
      .catch(raison => { if (vivant) setErreur(raison instanceof Error ? raison.message : 'Liste indisponible.') })
    return () => { vivant = false }
  }, [charger, tour])

  return (
    <div className="mm-modal-layer mm-online-layer" role="presentation" onMouseDown={event => event.target === event.currentTarget && fermer()}>
      <div ref={dialogRef} className="mm-online" role="dialog" aria-modal="true" aria-labelledby="online-title" tabIndex={-1}>
        <header>
          <h2 id="online-title"><Users aria-hidden="true" />En ligne</h2>
          <button type="button" aria-label="Rafraîchir la liste" onClick={rafraichir}><RefreshCw aria-hidden="true" /></button>
        </header>
        <p className="mm-online-note">Toi non compté · d’après le serveur</p>

        {erreur ? <p className="mm-online-vide" role="alert">{erreur}</p> : null}
        {joueurs === null && !erreur ? <p className="mm-online-vide">Lecture…</p> : null}
        {joueurs?.length === 0 ? <p className="mm-online-vide">Personne d’autre en ligne en ce moment.</p> : null}

        <ul className="mm-online-liste">
          {(joueurs ?? []).map((joueur, index) => {
            const detail = detailDePartie(joueur.activite)
            return (
              <li key={`${joueur.displayName}-${index}`} className={`mm-online-joueur is-${joueur.activite.quoi}`}>
                <div className="mm-online-qui">
                  <b>{joueur.displayName}</b>
                  <small>{joueur.invite ? 'Invité' : 'Compte'} · niv. {joueur.niveau} · vu il y a {dureeEnClair(joueur.vuIlYaS)}</small>
                </div>
                <p className="mm-online-quoi">{activiteEnClair(joueur.activite)}</p>
                {detail ? <p className="mm-online-detail">{detail}</p> : null}
                {joueur.partiesLentes > 0 ? (
                  <p className="mm-online-detail">{joueur.partiesLentes} partie{joueur.partiesLentes > 1 ? 's' : ''} en 24 h en cours</p>
                ) : null}
              </li>
            )
          })}
        </ul>

        <button type="button" className="mm-online-fermer" data-dialog-autofocus onClick={fermer}>Fermer</button>
      </div>
    </div>
  )
}
