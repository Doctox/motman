import { useEffect, useState, type ReactNode } from 'react'
import { BarChart3, ChevronRight, History, Trophy, UserPlus, Users } from 'lucide-react'
import { matchHistoryDateLabel, matchHistoryResultLabel, matchHistoryTone } from '../matchHistory'
import type { MatchHistoryEntry, MatchLobbyState, MatchPace, MatchState } from '../matches'
import { MatchReplay } from './MatchReplay'
import { playerInitials, type GuestIdentity } from '../playerIdentity'
import { rankImage, rankedDivision, rankedPlacementLabel } from '../ranked'
import type { RankedMatchmakingState } from '../rankedMatchmaking'
import type { SocialState } from '../social'
import { Avatar, SocialPortrait, presenceLabel } from './MenuChrome'
import { asyncTimeLeft, matchOpponent } from './HomePage'

// ─────────────────────────────────────────────────────────────────────────────
// L'ÉCRAN JOUER — trois onglets, une carte, l'historique toujours là.
//
// Maquette validée par le propriétaire le 16/09/2026. Les trois accordéons
// cachaient l'historique dès qu'on en ouvrait un : c'est ce qui a décidé la
// bascule vers des onglets. Seule la carte du milieu change ; la reprise et
// l'historique ne bougent jamais.
//
// Les pictogrammes restent les icônes lucide du reste de l'app, colorées par
// mode — vert pin, or, terracotta — plutôt que les emojis de la maquette : un
// emoji est multicolore là où la DA est monochrome, et son dessin change d'un
// téléphone à l'autre. Ils sont décoratifs, le libellé à côté porte le sens.
// ─────────────────────────────────────────────────────────────────────────────

type PlayTabId = 'normal' | 'ranked' | 'friends'

const ONGLETS: Array<{ id: PlayTabId; icone: ReactNode; label: string }> = [
  { id: 'normal', icone: <Trophy />, label: 'Normal' },
  { id: 'ranked', icone: <BarChart3 />, label: 'Classé' },
  { id: 'friends', icone: <Users />, label: 'Amis' },
]

const MODE_STORAGE_KEY = 'motman-dernier-mode'

/** Le dernier mode LANCÉ, pour rouvrir l'écran là où le joueur l'a laissé. */
function lireDernierMode(): PlayTabId {
  try {
    const range = localStorage.getItem(MODE_STORAGE_KEY)
    if (range === 'normal' || range === 'ranked' || range === 'friends') return range
  } catch {
    // Stockage privé indisponible : on repart de Normal, sans rien casser.
  }
  return 'normal'
}

function retenirMode(mode: PlayTabId): void {
  try { localStorage.setItem(MODE_STORAGE_KEY, mode) } catch { /* sans conséquence */ }
}

/** La partie à reprendre en premier : celle qui attend le joueur. */
function partieAReprendre(actives: MatchState[], playerId: string): MatchState | null {
  return actives.find(match => match.currentPlayerId === playerId) ?? actives[0] ?? null
}

function RecentMatchHistory({ matches }: { matches: MatchHistoryEntry[] }) {
  // Partie ouverte en relecture. Seules celles dont le plateau a survecu sont
  // cliquables : avant la colonne `final_board`, il n'existe plus nulle part.
  const [relecture, setRelecture] = useState<MatchHistoryEntry | null>(null)
  return <div className="mm-recent-history is-visible">
    <section className="mm-recent-history-card" aria-label="Historique des cinq derniers matchs">
      <header><span><History /></span><div><h2>Derniers matchs</h2><small>Vos cinq résultats les plus récents</small></div></header>
      {matches.length ? <div className="mm-recent-match-list">
        {matches.slice(0, 5).map(match => {
          const tone = matchHistoryTone(match.outcome)
          const opponentName = match.opponentName ?? 'Adversaire'
          // « Solo » a quitté l'interface : une partie de ce mode est un défi du
          // jour (il en porte la date) ou une partie d'entraînement d'avant.
          const modeLabel = match.dailyDate ? 'Défi du jour' : match.mode === 'solo' ? 'Entraînement' : 'Multijoueur'
          const relisible = Boolean(match.board)
          const contenu = <>
            <span className={`mm-recent-outcome ${tone}`}>{tone === 'won' ? 'V' : tone === 'drawn' ? 'N' : 'D'}</span>
            <span className="mm-recent-match-copy"><strong>{opponentName}</strong><small>{matchHistoryResultLabel(match.outcome)} · {modeLabel} · {match.pace === 'async' ? 'Illimité' : 'Limité'}</small></span>
            <span className="mm-recent-match-score"><b>{match.score}<i>–</i>{match.opponentScore}</b><small>{matchHistoryDateLabel(match.completedAt)}</small></span>
          </>
          return relisible
            ? <button type="button" className="mm-recent-match-row is-replayable" key={match.id} onClick={() => setRelecture(match)} aria-label={`Revoir la partie contre ${opponentName}`}>{contenu}</button>
            : <article className="mm-recent-match-row" key={match.id}>{contenu}</article>
        })}
      </div> : <div className="mm-recent-history-empty"><History /><strong>Aucun match terminé</strong><small>Vos prochaines parties apparaîtront ici.</small></div>}
    </section>
    {relecture ? <MatchReplay match={relecture} onClose={() => setRelecture(null)} /> : null}
  </div>
}

/** Les deux rythmes, côte à côte. Le même bloc sert à Normal et à Amis. */
function PaceChoice({ pace, setPace, label }: { pace: MatchPace; setPace: (pace: MatchPace) => void; label: string }) {
  return <div className="mm-pace-choice" role="group" aria-label={label}>
    <button type="button" className={pace === 'realtime' ? 'active' : ''} aria-pressed={pace === 'realtime'} aria-label="Temps limité, 45 secondes par tour" onClick={() => setPace('realtime')}>
      <strong>Temps limité</strong><small>45 s par tour</small>
    </button>
    <button type="button" className={pace === 'async' ? 'active' : ''} aria-pressed={pace === 'async'} aria-label="Temps illimité, 24 heures par tour" onClick={() => setPace('async')}>
      <strong>Temps illimité</strong><small>24 h par tour</small>
    </button>
  </div>
}

/** Une recherche en cours : la carte se replie sur une seule ligne. */
function SearchingCard({ titre, detail, annuler, disabled }: { titre: string; detail: string; annuler: () => void; disabled: boolean }) {
  return <section className="mm-play-card is-searching" aria-live="polite">
    <span className="mm-search-pulse" aria-hidden="true"><i /><i /><i /></span>
    <span className="mm-play-searching-copy"><strong>{titre}</strong><small>{detail}</small></span>
    <button type="button" className="mm-search-cancel" disabled={disabled} onClick={annuler}>Annuler</button>
  </section>
}

export function PlayPage({ identity, social, lobby, invite, cancelInvite, searchMatch, cancelSearch, resumeMatch, openFriends, ranked, rankedBusy, rankedTimedOut, rankedError, startRanked, cancelRanked }: {
  identity: GuestIdentity
  social: SocialState
  lobby: MatchLobbyState
  invite: (friendId: string, pace: MatchPace) => Promise<void>
  cancelInvite: (invitationId: string) => Promise<void>
  searchMatch: (pace: MatchPace) => Promise<void>
  cancelSearch: (pace: MatchPace) => Promise<void>
  resumeMatch: (matchId: string) => void
  openFriends: () => void
  ranked: RankedMatchmakingState
  rankedBusy: boolean
  /** Vrai après une recherche restée sans adversaire (voir rankedSearchExpired). */
  rankedTimedOut: boolean
  rankedError: string | null
  startRanked: () => Promise<void>
  cancelRanked: () => Promise<void>
}) {
  const [onglet, setOnglet] = useState<PlayTabId>(lireDernierMode)
  const [normalPace, setNormalPace] = useState<MatchPace>('realtime')
  const [friendPace, setFriendPace] = useState<MatchPace>('realtime')
  const [matchBusy, setMatchBusy] = useState<string | null>(null)
  const [searchBusy, setSearchBusy] = useState<MatchPace | null>(null)

  const realtimeSearching = lobby.searches.some(search => search.pace === 'realtime')
  const asyncSearching = lobby.searches.some(search => search.pace === 'async')
  const normalSearching = realtimeSearching || asyncSearching
  const rankedSearching = ranked.status === 'searching' || ranked.status === 'ready' || ranked.status === 'accepted'
  const currentRank = rankedDivision(ranked.progress.points, ranked.progress.matches)
  const reprise = partieAReprendre(lobby.active, identity.playerId)
  const amisEnLigne = social.friends.filter(friend => friend.online).length
  const invitationEnAttente = lobby.incoming.length > 0

  // Une recherche lancée depuis un autre écran ramène le joueur sur son mode.
  useEffect(() => {
    if (normalSearching) setOnglet('normal')
    else if (rankedSearching) setOnglet('ranked')
  }, [normalSearching, rankedSearching])

  const choisirOnglet = (id: PlayTabId) => setOnglet(id)

  const lancerRechercheNormale = async () => {
    retenirMode('normal')
    setSearchBusy(normalPace)
    try { await searchMatch(normalPace) } finally { setSearchBusy(null) }
  }

  const arreterRecherche = async (pace: MatchPace) => {
    setSearchBusy(pace)
    try { await cancelSearch(pace) } finally { setSearchBusy(null) }
  }

  return <div className="mm-page mm-play-page">
    <div className="mm-play-tabs" role="tablist" aria-label="Mode de jeu">
      {ONGLETS.map(({ id, icone, label }) => <button
        type="button"
        key={id}
        id={`mm-${id}-tab`}
        role="tab"
        className={onglet === id ? 'is-active' : ''}
        aria-selected={onglet === id}
        aria-controls="mm-play-mode"
        aria-label={id === 'friends' && invitationEnAttente ? `${label}, une invitation vous attend` : label}
        onClick={() => choisirOnglet(id)}
      >
        <i aria-hidden="true">{icone}</i>{label}
        {id === 'friends' && invitationEnAttente ? <span className="mm-play-tab-badge" aria-hidden="true" /> : null}
      </button>)}
    </div>

    {reprise ? <button type="button" className="mm-play-resume" onClick={() => resumeMatch(reprise.id)}>
      <Avatar label={playerInitials(matchOpponent(reprise, identity.playerId))} small />
      <span className="mm-play-resume-copy">
        <strong>{matchOpponent(reprise, identity.playerId)} · {reprise.currentPlayerId === identity.playerId ? 'à vous' : 'en attente'}</strong>
        <small>{reprise.pace === 'async' ? `Illimité · ${asyncTimeLeft(reprise)}` : 'Temps limité'}</small>
      </span>
      <span className="mm-play-resume-go">Reprendre</span>
    </button> : null}

    <div id="mm-play-mode" className="mm-play-mode" role="tabpanel" aria-labelledby={`mm-${onglet}-tab`}>
      {onglet === 'normal' ? (normalSearching
        ? <SearchingCard
          titre="Recherche d’un adversaire…"
          detail={asyncSearching ? 'Vous pouvez revenir plus tard' : 'Un adversaire de votre niveau vous sera proposé'}
          disabled={searchBusy !== null}
          annuler={() => void arreterRecherche(asyncSearching ? 'async' : 'realtime')}
        />
        : <section className="mm-play-card">
          <header>
            <span className="mm-play-card-icon" aria-hidden="true"><Trophy /></span>
            <span><h2>Normal</h2><small>Adversaire au hasard · sans classement</small></span>
          </header>
          <PaceChoice pace={normalPace} setPace={setNormalPace} label="Choisir le rythme de la partie" />
          <button type="button" className="mm-play-cta" aria-label="Jouer une partie normale" disabled={searchBusy !== null} onClick={() => void lancerRechercheNormale()}>
            Jouer <ChevronRight />
          </button>
        </section>) : null}

      {onglet === 'ranked' ? <section className="mm-play-card is-gold">
        <header>
          <span className="mm-play-card-icon" aria-hidden="true"><BarChart3 /></span>
          <span><h2>Classé</h2><small>45 s par tour · adversaire de rang proche</small></span>
        </header>
        <div className="mm-ranked-status">
          <img src={rankImage(currentRank)} alt="" />
          <span><small>Votre rang</small><strong>{currentRank.label}</strong><b>{rankedPlacementLabel(ranked.progress.matches)}</b></span>
          {ranked.progress.matches >= 5 ? <em>{ranked.progress.points} pt</em> : null}
        </div>
        {rankedSearching
          ? <div className="mm-play-searching-inline" aria-live="polite">
            <span className="mm-search-pulse" aria-hidden="true"><i /><i /><i /></span>
            <span>Recherche classée en cours</span>
            <button type="button" className="mm-search-cancel" disabled={rankedBusy || ranked.status === 'accepted'} onClick={() => void cancelRanked()}>Annuler</button>
          </div>
          : <button type="button" className="mm-play-cta is-gold" aria-label="Jouer une partie classée" disabled={rankedBusy || ranked.status === 'started'} onClick={() => { retenirMode('ranked'); void startRanked() }}>
            {ranked.status === 'started' ? 'Partie classée en cours' : 'Jouer'} <ChevronRight />
          </button>}
        {rankedTimedOut && !rankedSearching ? <p className="mm-ranked-timeout" role="status">
          Personne n’a été trouvé en dix minutes — la recherche s’est arrêtée. Vous pouvez la relancer.
        </p> : null}
        <p className="mm-ranked-explainer">La recherche continue en arrière-plan. Une partie normale limitée sera seulement mise en pause pendant la confirmation.</p>
        {rankedError ? <p className="mm-social-error" role="alert">{rankedError}</p> : null}
      </section> : null}

      {onglet === 'friends' ? <>
        <section className="mm-play-card is-coral">
          <header>
            <span className="mm-play-card-icon" aria-hidden="true"><Users /></span>
            <span><h2>Amis</h2><small>{amisEnLigne ? `${amisEnLigne} ami${amisEnLigne > 1 ? 's' : ''} en ligne` : 'Invitez un proche à une partie'}</small></span>
          </header>
          <PaceChoice pace={friendPace} setPace={setFriendPace} label="Choisir le rythme de la partie entre amis" />
        </section>

        <div className="mm-play-friends">
        {lobby.outgoing.map(invitation => <div className="mm-friend-line is-waiting" key={invitation.id}>
          <Avatar label={playerInitials(invitation.guest?.displayName ?? 'A')} small />
          <span className="mm-friend-line-copy">
            <strong>{invitation.guest?.displayName ?? 'Votre ami'}</strong>
            <small>{invitation.pace === 'async' ? 'Temps illimité' : 'Temps limité'} · invitation envoyée…</small>
          </span>
          <button type="button" disabled={matchBusy !== null} onClick={async () => { setMatchBusy(invitation.id); await cancelInvite(invitation.id); setMatchBusy(null) }}>Annuler</button>
        </div>)}

        {social.friends.map(friend => {
          const dejaInvite = lobby.outgoing.some(invitation => invitation.guestId === friend.playerId)
          const injoignable = friendPace === 'realtime' && (!friend.online || friend.activity === 'playing')
          return <div className={`mm-friend-line ${friend.online ? '' : 'is-offline'}`} key={friend.playerId}>
            <span className="mm-home-friend-avatar"><SocialPortrait user={friend} small /><i className={friend.activity} /></span>
            <span className="mm-friend-line-copy">
              <strong>{friend.displayName}</strong>
              <small>{injoignable && !dejaInvite ? `${presenceLabel(friend.activity)} · invitation en illimité` : presenceLabel(friend.activity)}</small>
            </span>
            <button
              type="button"
              disabled={injoignable || dejaInvite || matchBusy !== null}
              aria-label={`Inviter ${friend.displayName}`}
              onClick={async () => { retenirMode('friends'); setMatchBusy(friend.playerId); await invite(friend.playerId, friendPace); setMatchBusy(null) }}
            >{dejaInvite ? 'Envoyée' : friendPace === 'realtime' && friend.activity === 'playing' ? 'En jeu' : 'Inviter'}</button>
          </div>
        })}

        <button type="button" className="mm-friend-line mm-friend-line-add" onClick={openFriends}>
          <span className="mm-friend-line-plus" aria-hidden="true"><UserPlus /></span>
          <span className="mm-friend-line-copy"><strong>Ajouter un ami</strong><small>Avec son code ami</small></span>
          <span className="mm-friend-line-open">Ouvrir</span>
        </button>
        </div>
      </> : null}
    </div>

    <RecentMatchHistory matches={lobby.recent} />
  </div>
}
