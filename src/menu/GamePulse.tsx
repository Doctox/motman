import { useEffect, useState } from 'react'
import { Activity, ChevronRight, Ghost, RefreshCw, ShieldAlert } from 'lucide-react'
import { loadGamePulse, setGhostSwitch, type GamePulse } from '../matches'
import { useDialogFocus } from '../useDialogFocus'
import { useTirerPourFermer } from './tirerPourFermer'
import { ModerationPanel } from './ModerationPanel'
import { OnlinePlayersPanel } from './OnlinePlayersPanel'
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

/** « Sa note : 982 · 9 parties, 3 gagnées, 6 perdues » — l'équilibre du fantôme (13/10/2026). */
export function noteDuFantome(note: NonNullable<GamePulse['fantomeNote']>): string {
  const parties = `${note.matches} partie${note.matches > 1 ? 's' : ''}`
  const egalites = note.draws ? `, ${note.draws} nulle${note.draws > 1 ? 's' : ''}` : ''
  return `Sa note : ${note.points} · ${parties}, ${note.wins} gagnée${note.wins > 1 ? 's' : ''}, ${note.losses} perdue${note.losses > 1 ? 's' : ''}${egalites}`
}

/** « 1 012 · 7 parties », ou « arrive le 16/10 » tant qu'il n'est pas là (13/10/2026). */
export function ligneDOmbre(ombre: { arrivee: string; points: number; parties: number }, maintenant = Date.now()): string {
  if (Date.parse(ombre.arrivee) > maintenant) {
    const jour = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Paris' }).format(new Date(ombre.arrivee))
    return `arrive le ${jour}`
  }
  if (!ombre.parties) return 'arrivé·e, pas encore joué'
  return `${ombre.points} · ${ombre.parties} partie${ombre.parties > 1 ? 's' : ''}`
}

const NOMS_DES_CANAUX: Record<string, string> = {
  google: 'Google',
  recherche: 'Autre moteur de recherche',
  'play-store': 'Play Store',
  'app-store': 'App Store',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  facebook: 'Facebook',
  site: 'Adresse tapée ou favori',
  autre: 'Un autre site',
}

/** Le nom d'un canal d'arrivée (17/10/2026, src/sourceDuJoueur.ts) ; un lien marqué inconnu garde son marqueur. */
export function nomDuCanal(canal: string): string {
  if (NOMS_DES_CANAUX[canal]) return NOMS_DES_CANAUX[canal]
  if (canal.startsWith('lien-')) return `Lien « ${canal.slice('lien-'.length)} »`
  return canal
}

/** « 3 cette semaine · 7 sur 30 jours » */
export function ligneDeSource(source: { semaine: number; mois: number }): string {
  return `${source.semaine} cette semaine · ${source.mois} sur 30 jours`
}

/** « signalement » ou « signalements » : zéro reste au singulier. */
export function libelleSignalements(nombre: number): string {
  return nombre > 1 ? 'signalements' : 'signalement'
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
  const [moderation, setModeration] = useState(false)
  const [enLigne, setEnLigne] = useState(false)
  const aTraiter = pouls.signalementsOuverts ?? 0
  return (
    <>
      <button
        type="button"
        className="mm-pulse"
        aria-label={aTraiter > 0
          ? `${aTraiter} ${libelleSignalements(aTraiter)} à traiter, et ${pouls.enLigne} ${libelleEnLigne(pouls.enLigne)}`
          : `${pouls.enLigne} ${libelleEnLigne(pouls.enLigne)} — voir le pouls du jeu`}
        onClick={() => setOuvert(true)}
      >
        <Activity aria-hidden="true" />
        <b>{pouls.enLigne}</b>
        <span>
          {libelleEnLigne(pouls.enLigne)}
          {/* La pastille est le seul rouge de l'accueil : elle ne se confond
              avec rien, et elle n'apparaît que s'il y a vraiment à faire. */}
          {aTraiter > 0 ? <em className="mm-pulse-badge">{aTraiter} {libelleSignalements(aTraiter)}</em> : null}
        </span>
        <ChevronRight aria-hidden="true" />
      </button>
      {ouvert && (
        <GamePulseDialog
          pouls={pouls}
          fermer={() => setOuvert(false)}
          rafraichir={rafraichir}
          ouvrirModeration={() => { setOuvert(false); setModeration(true) }}
          ouvrirEnLigne={() => { setOuvert(false); setEnLigne(true) }}
        />
      )}
      {/* Une seule fenêtre à la fois : la modération remplace le pouls. */}
      {moderation && <ModerationPanel fermer={() => { setModeration(false); rafraichir() }} />}
      {/* Qui est en ligne (11/10/2026) : au retour, le pouls se rouvre. */}
      {enLigne && <OnlinePlayersPanel fermer={() => { setEnLigne(false); setOuvert(true) }} />}
    </>
  )
}

function Ligne({ nom, valeur }: { nom: string; valeur: number }) {
  return <div><dt>{nom}</dt><dd>{valeur}</dd></div>
}

/**
 * L'interrupteur du fantôme (11/10/2026) : allumé, il prend la place du
 * propriétaire en classée quand un joueur attend depuis une minute et que
 * personne d'autre n'est en ligne. Le serveur revérifie le rôle à chaque appui.
 */
export function InterrupteurFantome({ allumeAuDepart, basculer = setGhostSwitch }: {
  allumeAuDepart: boolean
  basculer?: (allume: boolean) => Promise<boolean>
}) {
  const [allume, setAllume] = useState(allumeAuDepart)
  const [occupe, setOccupe] = useState(false)
  const [rate, setRate] = useState(false)
  const changer = (voulu: boolean) => {
    setOccupe(true)
    setRate(false)
    basculer(voulu)
      .then(setAllume)
      .catch(() => setRate(true))
      .finally(() => setOccupe(false))
  }
  return (
    <>
      <label className="mm-setting-row mm-pulse-fantome">
        <span>
          <Ghost aria-hidden="true" />
          <span>
            Fantôme en classée
            <small>{allume ? 'Joue à ta place quand personne n’est en ligne' : 'Éteint : les joueurs attendent un vrai adversaire'}</small>
          </span>
        </span>
        <input type="checkbox" role="switch" aria-label="Fantôme en classée" checked={allume} disabled={occupe} onChange={event => changer(event.currentTarget.checked)} />
        <i aria-hidden="true" />
      </label>
      {rate ? <p className="mm-pulse-note" role="alert">Réglage non enregistré, réessaie.</p> : null}
    </>
  )
}

function GamePulseDialog({ pouls, fermer, rafraichir, ouvrirModeration, ouvrirEnLigne }: {
  pouls: GamePulse
  fermer: () => void
  rafraichir: () => void
  ouvrirModeration: () => void
  ouvrirEnLigne: () => void
}) {
  const dialogRef = useDialogFocus<HTMLDivElement>(fermer)
  // Fermer en tirant la fenêtre vers le bas par son en-tête (G2, 15/10/2026).
  useTirerPourFermer(dialogRef, fermer)
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

        {/* Ce qui appelle une action passe AVANT ce qui informe. */}
        {(pouls.signalementsOuverts ?? 0) > 0 ? (
          <button type="button" className="mm-pulse-alerte" onClick={ouvrirModeration}>
            <ShieldAlert aria-hidden="true" />
            <span>
              <b>{pouls.signalementsOuverts} {libelleSignalements(pouls.signalementsOuverts)} à traiter</b>
              <small>
                {pouls.signalementPlusAncienHeures >= 1
                  ? `Le plus ancien attend depuis ${pouls.signalementPlusAncienHeures} h`
                  : 'Arrivé à l’instant'}
              </small>
            </span>
            <ChevronRight aria-hidden="true" />
          </button>
        ) : null}

        <h3>En ce moment</h3>
        {/* Derrière le nombre, qui et quoi (11/10/2026). */}
        <button type="button" className="mm-pulse-enligne" onClick={ouvrirEnLigne} aria-label={`${pouls.enLigne} en ligne — voir qui et ce qu’ils font`}>
          <span>En ligne</span>
          <b>{pouls.enLigne}</b>
          <ChevronRight aria-hidden="true" />
        </button>

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

        {/* D'où viennent les nouveaux (17/10/2026) : comptés depuis ce jour-là. */}
        <h3>D’où viennent les nouveaux</h3>
        {pouls.sources?.length
          ? <dl>{pouls.sources.map(source => <div key={source.canal}><dt>{nomDuCanal(source.canal)}</dt><dd className="mm-pulse-ombre">{ligneDeSource(source)}</dd></div>)}</dl>
          : <p className="mm-pulse-note">Aucune arrivée comptée pour l’instant : le décompte a commencé le 17/10.</p>}

        <h3>Ton fantôme</h3>
        <InterrupteurFantome allumeAuDepart={pouls.fantome !== false} />
        {pouls.fantomeNote ? <p className="mm-pulse-note">{noteDuFantome(pouls.fantomeNote)}</p> : null}

        {pouls.ombres?.length ? <>
          <h3>Joueurs de l’ombre</h3>
          <dl>{pouls.ombres.map(ombre => <div key={ombre.nom}><dt>{ombre.nom}</dt><dd className="mm-pulse-ombre">{ligneDOmbre(ombre)}</dd></div>)}</dl>
        </> : null}

        <button type="button" className="mm-pulse-fermer" data-dialog-autofocus onClick={fermer}>Fermer</button>
      </div>
    </div>
  )
}
