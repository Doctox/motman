import { useEffect, useState } from 'react'
import { Activity, ChevronRight, RefreshCw } from 'lucide-react'
import { loadGamePulse, type GamePulse } from '../matches'
import { useDialogFocus } from '../useDialogFocus'
import './menu-pulse.css'

// ─────────────────────────────────────────────────────────────────────────────
// LE POULS DU JEU — VISIBLE DU SEUL PROPRIÉTAIRE (20/09/2026)
//
// Demandé le jour de la sortie : savoir d'un coup d'œil combien de joueurs sont
// là, sans ouvrir le tableau de bord Supabase ni écrire du SQL.
//
// UNE LIGNE, PUIS UNE FENÊTRE. La première version posait huit nombres sur
// l'accueil ; le propriétaire a tranché le soir même : « là c'est le bordel ».
// L'accueil ne garde donc que LE chiffre qu'il regarde — combien d'autres
// joueurs sont en ligne maintenant — et tout le reste attend derrière un
// appui, rangé par période au lieu d'être aligné en vrac.
//
// LUI NON COMPTÉ, partout. Il lit ce cadre depuis l'appli : il y serait
// toujours compté, et « 2 en ligne » signifiait « lui, et une autre personne ».
// L'exclusion est faite EN BASE, pas ici : un « moins un » côté écran se
// tromperait dès qu'il regarde depuis deux appareils, ou depuis un compte qui
// n'est pas le sien.
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

/** « joueur » ou « joueurs » : en français, zéro reste au singulier. */
export function libelleEnLigne(enLigne: number): string {
  return enLigne > 1 ? 'joueurs en ligne' : 'joueur en ligne'
}

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

  if (erreur || !pouls) return null
  return <GamePulseCard pouls={pouls} rafraichir={() => setTour(valeur => valeur + 1)} />
}

/**
 * L'affichage seul, sans réseau : c'est lui qu'on met sous les yeux du
 * propriétaire avant de déployer, et lui qu'un test peut tenir.
 */
export function GamePulseCard({ pouls, rafraichir }: { pouls: GamePulse; rafraichir: () => void }) {
  const [ouvert, setOuvert] = useState(false)
  return (
    <>
      <button
        type="button"
        className="mm-pulse"
        aria-label={`${pouls.enLigne} ${libelleEnLigne(pouls.enLigne)} — voir le pouls du jeu`}
        onClick={() => setOuvert(true)}
      >
        <Activity aria-hidden="true" />
        <b>{pouls.enLigne}</b>
        <span>{libelleEnLigne(pouls.enLigne)}</span>
        <ChevronRight aria-hidden="true" />
      </button>
      {ouvert && <GamePulseDialog pouls={pouls} fermer={() => setOuvert(false)} rafraichir={rafraichir} />}
    </>
  )
}

function Ligne({ nom, valeur }: { nom: string; valeur: number }) {
  return <div><dt>{nom}</dt><dd>{valeur}</dd></div>
}

function GamePulseDialog({ pouls, fermer, rafraichir }: {
  pouls: GamePulse
  fermer: () => void
  rafraichir: () => void
}) {
  const dialogRef = useDialogFocus<HTMLDivElement>(fermer)
  return (
    <div
      className="mm-modal-layer mm-pulse-layer"
      role="presentation"
      onMouseDown={event => event.target === event.currentTarget && fermer()}
    >
      <div ref={dialogRef} className="mm-pulse-dialog" role="dialog" aria-modal="true" aria-labelledby="pulse-title" tabIndex={-1}>
        <header>
          <h2 id="pulse-title"><Activity aria-hidden="true" />Le pouls du jeu</h2>
          <button type="button" aria-label="Rafraîchir les chiffres" onClick={rafraichir}>
            <RefreshCw aria-hidden="true" />
          </button>
        </header>
        {/* Dit une fois, en haut : sinon chaque nombre devrait le répéter. */}
        <p className="mm-pulse-note">Toi non compté · journée de Paris</p>

        <h3>En ce moment</h3>
        <dl><Ligne nom="En ligne" valeur={pouls.enLigne} /></dl>

        <h3>Aujourd’hui</h3>
        <dl>
          <Ligne nom="Joueurs" valeur={pouls.actifsDuJour} />
          <Ligne nom="Parties" valeur={pouls.partiesDuJour} />
          <Ligne nom="Défis du jour joués" valeur={pouls.defisDuJour} />
          <Ligne nom="Nouveaux joueurs" valeur={pouls.nouveauxDuJour} />
        </dl>

        <h3>Cette semaine</h3>
        <dl>
          <Ligne nom="Joueurs" valeur={pouls.actifsSeptJours} />
          <Ligne nom="Parties classées" valeur={pouls.classeesSeptJours} />
        </dl>

        <h3>En tout</h3>
        <dl><Ligne nom="Comptes" valeur={pouls.comptes} /></dl>

        <button type="button" className="mm-pulse-fermer" data-dialog-autofocus onClick={fermer}>Fermer</button>
      </div>
    </div>
  )
}
