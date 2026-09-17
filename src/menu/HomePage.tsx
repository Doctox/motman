import { useState } from 'react'
import { ChevronRight, Copy, Feather, Gamepad2, UserPlus } from 'lucide-react'
import { CosmeticPortrait } from '../CosmeticPortrait'
import type { PlayerCosmetics } from '../cosmetics'
import type { MatchLobbyState, MatchState } from '../matches'
import { playerInitials, type GuestIdentity, shortPlayerId } from '../playerIdentity'
import { experienceGoalForLevel, MAX_PLAYER_LEVEL, type PlayerProgress } from '../playerProgress'
import { rankImage, rankedDivision } from '../ranked'
import type { SocialState } from '../social'
import { Avatar, SocialPortrait, presenceLabel } from './MenuChrome'
import { DailyChallengeHero, DailyRankTeaser } from './DailyChallenge'

const frenchNumber = new Intl.NumberFormat('fr-FR')

export function matchOpponent(match: MatchState, playerId: string): string {
  return match.players.find(player => player.playerId !== playerId)?.displayName ?? 'Adversaire'
}

export function asyncTimeLeft(match: MatchState): string {
  const remaining = Math.max(0, new Date(match.turnEndsAt).getTime() - Date.now())
  return remaining >= 3_600_000
    ? `${Math.ceil(remaining / 3_600_000)} h`
    : `${Math.max(1, Math.ceil(remaining / 60_000))} min`
}

function activeMatchLabel(match: MatchState): string {
  // Le défi du jour porte le mode `solo` en base ; le mot a quitté l'interface
  // le 16/09/2026, il ne doit plus apparaître ici.
  if (match.isDaily) return 'Défi du jour'
  if (match.mode === 'solo') return 'Entraînement'
  if (match.mode === 'friend') return 'Duel ami'
  return 'Match normal'
}

export function HomePage({ identity, progress, cosmetics, social, lobby, play, playDaily, openFriends, openRanking, resumeMatch }: { identity: GuestIdentity; progress: PlayerProgress; cosmetics: PlayerCosmetics; social: SocialState; lobby: MatchLobbyState; play: () => void; playDaily: () => void; openFriends: () => void; openRanking: () => void; resumeMatch: (matchId: string) => void }) {
  const firstRequest = social.incoming[0]
  const codeAmi = shortPlayerId(identity.playerId)
  // Partage natif quand l'appareil le propose, presse-papiers sinon. Les deux
  // peuvent echouer (permission refusee, contexte non securise) : on retombe
  // alors sur l'affichage du code, qui reste utilisable a la main.
  const [codePartage, setCodePartage] = useState<string | null>(null)
  const partagerCode = async () => {
    const texte = `Rejoins-moi sur MotMan ! Mon code ami : ${codeAmi}`
    try {
      if (navigator.share) { await navigator.share({ text: texte }); return }
      await navigator.clipboard.writeText(codeAmi)
      setCodePartage('Code ami copié')
    } catch (raison) {
      // FERMER LA FEUILLE DE PARTAGE N'EST PAS UNE ERREUR. Sur Android,
      // `navigator.share` rejette avec `AbortError` quand le joueur renonce —
      // le cas de loin le plus fréquent ici. On ne dit donc rien.
      if (raison instanceof Error && raison.name === 'AbortError') return
      // Et en cas d'échec réel, inutile de réafficher le code : le bouton
      // juste au-dessus le montre déjà. C'était une répétition pure.
      setCodePartage('Copie impossible — le code est sur le bouton')
    }
  }
  const presenceWeight = { offline: 0, online: 1, playing: 2 }
  // Tous les amis, déconnectés compris (demande du propriétaire, 17/09/2026) :
  // la rangée n'en montrait que trois, et les absents disparaissaient. Les
  // connectés passent devant — ce sont ceux avec qui on peut jouer tout de
  // suite —, et c'est la RANGÉE qui décide combien tiennent : deux lignes, avec
  // autant de visages par ligne que la largeur en accepte. Aucun nombre figé
  // ici : un écran large en montre plus, sans qu'on ait à le prévoir.
  const visibleFriends = [...social.friends].sort((left, right) => presenceWeight[right.activity] - presenceWeight[left.activity])
  const xpGoal = experienceGoalForLevel(progress.level)
  const xpPercent = progress.level >= MAX_PLAYER_LEVEL ? 100 : Math.min(100, progress.xp / xpGoal * 100)
  const currentRank = rankedDivision(progress.rankedPoints, progress.rankedMatches)
  const currentMatches = lobby.active
    .filter(match => match.pace === 'async')
    .sort((left, right) => {
      const leftTurn = left.currentPlayerId === identity.playerId ? 0 : 1
      const rightTurn = right.currentPlayerId === identity.playerId ? 0 : 1
      return leftTurn - rightTurn || new Date(left.turnEndsAt).getTime() - new Date(right.turnEndsAt).getTime()
    })
  // Accueil refondu le 16/09/2026 (maquette validée). La grosse carte de profil
  // a laissé place à une barre compacte : elle disait la même chose en prenant
  // le tiers de l'écran, au détriment du défi du jour et des parties qui
  // attendent — les deux seules choses sur lesquelles le joueur peut agir.
  return <div className="mm-page mm-home-page">
    <section className="mm-home-account" aria-label="Votre compte">
      <CosmeticPortrait avatarId={cosmetics.equippedAvatarId} frameId={cosmetics.equippedFrameId} animationId={cosmetics.equippedAnimationId} alt="Votre avatar" />
      <div className="mm-home-account-copy">
        <div className="mm-home-account-line">
          <h1>{identity.displayName}</h1>
          <span className="mm-home-feathers" aria-label={`${frenchNumber.format(cosmetics.plumes)} plumes`}><Feather aria-hidden="true" /><b>{frenchNumber.format(cosmetics.plumes)}</b></span>
        </div>
        <i className="mm-home-account-xp" aria-hidden="true"><b style={{ width: `${xpPercent}%` }} /></i>
        <div className="mm-home-account-line">
          <small>Niveau {progress.level}{progress.level >= MAX_PLAYER_LEVEL ? '' : ` · ${progress.xp} / ${xpGoal} XP`}</small>
          <strong className="mm-home-rank"><img src={rankImage(currentRank)} alt="" />{currentRank.label}</strong>
        </div>
      </div>
    </section>
    <section className="mm-attention">
      <DailyChallengeHero onPlay={playDaily} />
      <DailyRankTeaser onOpenRanking={openRanking} />
      <header className="mm-attention-heading">
        <h2>Partie</h2>
        {currentMatches.length ? <span aria-label={`${currentMatches.length} partie${currentMatches.length > 1 ? 's' : ''} en cours`}>{currentMatches.length} en cours</span> : null}
      </header>
      {currentMatches.length ? <div className="mm-home-active-match-list">
        {currentMatches.map(match => {
          const opponentName = matchOpponent(match, identity.playerId)
          const myTurn = match.currentPlayerId === identity.playerId
          return <button type="button" className={`mm-current-match-card ${myTurn ? 'is-my-turn' : ''}`} onClick={() => resumeMatch(match.id)} key={match.id}>
            <Avatar label={playerInitials(opponentName)} small />
            <span>
              <strong>{opponentName} · {myTurn ? 'à vous' : 'en attente'}</strong>
              <small>{activeMatchLabel(match)} · {asyncTimeLeft(match)}</small>
            </span>
            {myTurn ? <em className="mm-current-match-go">Reprendre</em> : <ChevronRight />}
          </button>
        })}
      </div> : null}
      {/* « Nouvelle partie » ne s'affiche QUE sans partie en cours (demande du
          propriétaire) : tant qu'une partie attend, on la reprend, on n'en
          ouvre pas une autre à côté. */}
      {currentMatches.length ? null : <button type="button" className="mm-home-new-match" onClick={play}>
        <Gamepad2 aria-hidden="true" />Nouvelle partie <ChevronRight />
      </button>}
    </section>
    <section className="mm-home-friends">
      <header><h2>Amis</h2><button type="button" onClick={openFriends}><UserPlus />Ajouter</button></header>
      {firstRequest ? <button type="button" className="mm-home-friend-request" onClick={openFriends}>
        <SocialPortrait user={firstRequest.user} small />
        <span><strong>{firstRequest.user.displayName}</strong><small>vous envoie une demande d’ami</small></span>
        <b>{social.incoming.length}</b><ChevronRight />
      </button> : null}
      {/* Une rangée de visages plutôt qu'une liste : on vient y lire qui est là,
          pas des lignes de texte. Pas de tuile « Ajouter » ici — le bouton de
          l'en-tête fait déjà cela, et à trois amis les noms se couperaient. */}
      {visibleFriends.length ? <div className="mm-home-friend-row">
        {visibleFriends.map(friend => <div className="mm-home-friend" key={friend.playerId}>
          <span className="mm-home-friend-avatar"><SocialPortrait user={friend} small /><i className={friend.activity} /></span>
          <strong>{friend.displayName}</strong>
          <small>{presenceLabel(friend.activity)}</small>
        </div>)}
      </div> : <>
        <button type="button" className="mm-home-add-first" onClick={openFriends}><span><UserPlus /></span><div><strong>Ajouter votre premier ami</strong><small>Jouez bientôt ensemble sur MotMan.</small></div><ChevronRight /></button>
        {/* Un joueur sans aucun ami doit pouvoir DONNER son code, pas seulement
            en saisir un : jusqu'ici il fallait ouvrir les paramètres pour le
            trouver (suggestion S-04, rapport 6766). C'est le seul moment où ce
            raccourci a du sens, d'où sa place dans l'état vide. */}
        <button type="button" className="mm-home-share-code" onClick={partagerCode}>
          <Copy /><span>Partager mon code : <b>{codeAmi}</b></span>
        </button>
        {codePartage ? <p className="mm-home-share-note" role="status">{codePartage}</p> : null}
      </>}
    </section>
  </div>
}
