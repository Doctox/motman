import { useRef, useState, type CSSProperties } from 'react'
import { ChevronRight, Copy, Feather, Gamepad2, UserPlus } from 'lucide-react'
import { CosmeticPortrait } from '../CosmeticPortrait'
import { ChiffresQuiRoulent } from '../ChiffresQuiRoulent'
import type { PlayerCosmetics } from '../cosmetics'
import type { MatchLobbyState, MatchState } from '../matches'
import { friendCodeOf, playerInitials, type GuestIdentity } from '../playerIdentity'
import { experienceGoalForLevel, MAX_PLAYER_LEVEL, type PlayerProgress } from '../playerProgress'
import { nomDuTitre } from '../titleNames'
import { rankImage, rankedDivision } from '../ranked'
import type { SocialState, SocialUser } from '../social'
import { ApercuFlottant, useAppuiLong } from './ApercuFlottant'
import { noterOrigineDeLaPartie } from '../transitionPartie'
import { Avatar, SocialPortrait, presenceLabel } from './MenuChrome'
import { DailyChallengeHero } from './DailyChallenge'
import { RankedSeekerBanner } from './RankedSeekerBanner'
import { ChronoRecherche } from './ChronoRecherche'
import type { RankedMatchmakingState } from '../rankedMatchmaking'
import { GamePulse } from './GamePulse'
import { MOTMAN_INVITE_URL } from '../dailyShare'

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

export function HomePage({ identity, progress, cosmetics, social, lobby, play, jouerPremierePartie, playWithFriends, playDaily, playRanked, openAccount, openFriends, openRanking, resumeMatch, ranked, voirRechercheClassee }: { identity: GuestIdentity; progress: PlayerProgress; cosmetics: PlayerCosmetics; social: SocialState; lobby: MatchLobbyState; play: () => void; jouerPremierePartie?: () => void; playWithFriends: () => void; playDaily: () => void; playRanked: () => void; openAccount: () => void; openFriends: () => void; openRanking: () => void; resumeMatch: (matchId: string) => void; ranked?: RankedMatchmakingState; voirRechercheClassee?: () => void }) {
  // MA RECHERCHE CLASSÉE SE VOIT AUSSI ICI (22/10/2026, code C3). Lancée, puis
  // l'accueil : plus rien ne disait qu'elle tournait, et une attente qu'on ne
  // voit plus ressemble à une panne. Le bandeau « des joueurs cherchent » me
  // proposait même de rejoindre une file où j'étais déjà.
  const rechercheClassee = ranked?.status === 'searching' || ranked?.status === 'ready' || ranked?.status === 'accepted'
  const firstRequest = social.incoming[0]
  const codeAmi = friendCodeOf(identity)
  // Partage natif quand l'appareil le propose, presse-papiers sinon. Les deux
  // peuvent echouer (permission refusee, contexte non securise) : on retombe
  // alors sur l'affichage du code, qui reste utilisable a la main.
  const [codePartage, setCodePartage] = useState<string | null>(null)
  const partagerCode = async () => {
    // Avec le lien, marqué : le message disait le code sans dire où jouer (23/10/2026).
    const texte = `Rejoins-moi sur MotMan ! Mon code ami : ${codeAmi}\n${MOTMAN_INVITE_URL}`
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
  // UN JOUEUR NEUF (22/10/2026, N2) : aucune partie finie, aucune en cours. Le
  // gros bouton terracotta du défi l'envoyait vers la seule partie qui ne se
  // rejoue pas, à thème, avec un classement public. Il voit d'abord « Jouer ma
  // première partie » ; le défi reste jouable, en bouton secondaire.
  const neuf = Boolean(jouerPremierePartie) && !lobby.active.length
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
    <section className="mm-home-account" aria-label="Ton compte">
      <CosmeticPortrait avatarId={cosmetics.equippedAvatarId} frameId={cosmetics.equippedFrameId} animationId={cosmetics.equippedAnimationId} alt="Ton avatar" />
      <div className="mm-home-account-copy">
        <div className="mm-home-account-line">
          {/* Le titre porté, sous le pseudo (12/10/2026). */}
          <span className="mm-home-account-who">
            <h1>{identity.displayName}</h1>
            {nomDuTitre(progress.equippedTitleId, progress.titles) ? <em className="mm-home-title">{nomDuTitre(progress.equippedTitleId, progress.titles)}</em> : null}
          </span>
          <span className="mm-home-feathers" aria-label={`${frenchNumber.format(cosmetics.plumes)} plumes`}><Feather aria-hidden="true" /><b><ChiffresQuiRoulent valeur={cosmetics.plumes} /></b></span>
        </div>
        <i className="mm-home-account-xp" aria-hidden="true"><b style={{ '--part': xpPercent / 100 } as CSSProperties} /></i>
        <div className="mm-home-account-line">
          {/* Des zéros qui disent quoi faire (N9) : « 0 / 100 XP » avant la
              première partie, « Non classé » pour un invité qui ne peut pas
              jouer en classé sans compte. */}
          <small>Niveau {progress.level}{progress.level >= MAX_PLAYER_LEVEL ? '' : progress.lifetimeXp === 0 ? ' · joue pour monter' : ` · ${progress.xp} / ${xpGoal} XP`}</small>
          {identity.accountType === 'account' || currentRank.id !== 'unranked' ? <strong className="mm-home-rank"><img src={rankImage(currentRank)} alt="" />{currentRank.label}</strong> : null}
        </div>
      </div>
    </section>
    <section className="mm-attention">
      {/* La salutation selon l'heure (E2) a été retirée le 15/10/2026 au soir :
          comparée sur une planche à trois autres formes, le propriétaire a
          préféré « sans rien ». */}
      {/* La place du jour vit DANS la carte depuis le 25/09/2026 : en ligne
          séparée, elle doublait le rang que la carte affichait déjà — et les
          deux chiffres se contredisaient. */}
      {neuf ? <>
        <header className="mm-attention-heading"><h2>Partie</h2></header>
        <button type="button" className="mm-home-new-match mm-home-first-game" onClick={jouerPremierePartie}>
          <Gamepad2 aria-hidden="true" /><span><strong>Jouer ma première partie</strong><small>Un adversaire en quelques secondes · une dizaine de minutes</small></span><ChevronRight aria-hidden="true" />
        </button>
      </> : null}
      <DailyChallengeHero onPlay={playDaily} onOpenRanking={openRanking} discret={neuf} />
      {/* Réservé au propriétaire : le serveur revérifie le rôle et refuse tout
          autre compte. Placé en haut, c'est la première chose qu'il regarde. */}
      {identity.admin ? <GamePulse /> : null}
      {rechercheClassee && ranked ? <button type="button" className="mm-ranked-search-reminder" onClick={voirRechercheClassee}>
        <ChronoRecherche depuis={ranked.queuedAt} />
        <span>Ta recherche classée continue</span>
        <span className="mm-ranked-search-reminder-voir">Voir<ChevronRight aria-hidden="true" /></span>
      </button> : null}
      <RankedSeekerBanner
        seekers={lobby.rankedSeekers ?? 0}
        estUnCompte={identity.accountType === 'account'}
        dejaEnClasse={rechercheClassee || lobby.active.some(partie => partie.mode === 'ranked')}
        // « Rejoindre » lance la recherche classée tout de suite (11/10/2026) :
        // il ouvrait seulement l'onglet Classé, où il fallait encore appuyer
        // sur « Jouer ».
        rejoindre={playRanked}
        creerCompte={openAccount}
      />
      {/* Chez un joueur neuf, le titre « Partie » est monté en haut, avec son
          seul bouton : ici, il n'aurait rien dessous. */}
      {neuf ? null : <header className="mm-attention-heading">
        <h2>Partie</h2>
        {currentMatches.length ? <span aria-label={`${currentMatches.length} partie${currentMatches.length > 1 ? 's' : ''} en cours`}>{currentMatches.length} en cours</span> : null}
      </header>}
      {currentMatches.length ? <div className="mm-home-active-match-list">
        {currentMatches.map(match => {
          const opponentName = matchOpponent(match, identity.playerId)
          const myTurn = match.currentPlayerId === identity.playerId
          return <button type="button" data-partie-origine={match.id} className={`mm-current-match-card ${myTurn ? 'is-my-turn' : ''}`} onClick={event => { noterOrigineDeLaPartie(event.currentTarget, match.id); resumeMatch(match.id) }} key={match.id}>
            <Avatar label={playerInitials(opponentName)} small />
            <span>
              <strong>{opponentName} · {myTurn ? 'à toi' : 'en attente'}</strong>
              <small>{activeMatchLabel(match)} · {asyncTimeLeft(match)}</small>
            </span>
            {myTurn ? <em className="mm-current-match-go">Reprendre</em> : <ChevronRight />}
          </button>
        })}
      </div> : null}
      {/* « Nouvelle partie » ne s'affiche QUE sans partie en cours (demande du
          propriétaire) : tant qu'une partie attend, on la reprend, on n'en
          ouvre pas une autre à côté. */}
      {currentMatches.length || neuf ? null : <button type="button" className="mm-home-new-match" onClick={play}>
        <Gamepad2 aria-hidden="true" />Nouvelle partie <ChevronRight />
      </button>}
    </section>
    <section className="mm-home-friends">
      <header><h2>Amis</h2><button type="button" onClick={openFriends}><UserPlus />Ajouter</button></header>
      {firstRequest ? <button type="button" className="mm-home-friend-request" onClick={openFriends}>
        <SocialPortrait user={firstRequest.user} small />
        <span><strong>{firstRequest.user.displayName}</strong><small>t’envoie une demande d’ami</small></span>
        <b>{social.incoming.length}</b><ChevronRight />
      </button> : null}
      {/* Une rangée de visages plutôt qu'une liste : on vient y lire qui est là,
          pas des lignes de texte. Pas de tuile « Ajouter » ici — le bouton de
          l'en-tête fait déjà cela, et à trois amis les noms se couperaient. */}
      {visibleFriends.length ? <div className="mm-home-friend-row">
        {/* Toucher un ami mène là où l'on joue avec lui : Jouer, onglet Amis
            (demande du propriétaire, 18/09/2026). */}
        {visibleFriends.map(friend => <AmiDeLAccueil key={friend.playerId} friend={friend} playWithFriends={playWithFriends} openFriends={openFriends} />)}
      </div> : <>
        <button type="button" className="mm-home-add-first" onClick={openFriends}><span><UserPlus /></span><div><strong>Ajouter ton premier ami</strong><small>Pour jouer ensemble sur MotMan.</small></div><ChevronRight /></button>
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

/**
 * Un ami de l'accueil. Le toucher mène là où l'on joue avec lui ; un appui
 * long ouvre sa fiche en grand, avec ses deux chemins (G9, 15/10/2026).
 */
function AmiDeLAccueil({ friend, playWithFriends, openFriends }: { friend: SocialUser; playWithFriends: () => void; openFriends: () => void }) {
  const bouton = useRef<HTMLButtonElement>(null)
  const [apercu, setApercu] = useState(false)
  useAppuiLong(bouton, () => setApercu(true))
  return <>
    <button ref={bouton} type="button" className="mm-home-friend" onClick={playWithFriends} aria-label={`Jouer avec ${friend.displayName}, ${presenceLabel(friend.activity).toLowerCase()}`}>
      <span className="mm-home-friend-avatar"><SocialPortrait user={friend} small /><i className={friend.activity} /></span>
      <strong>{friend.displayName}</strong>
      <small>{presenceLabel(friend.activity)}</small>
    </button>
    {apercu ? <ApercuFlottant libelle={`Fiche de ${friend.displayName}`} fermer={() => setApercu(false)}>
      {friend.avatarId
        ? <CosmeticPortrait avatarId={friend.avatarId} frameId={friend.frameId ?? 'cadre-ivoire'} animationId={friend.animationId} alt="" className="mm-portrait mm-apercu-portrait" />
        : <Avatar label={playerInitials(friend.displayName)} />}
      <strong>{friend.displayName}</strong>
      <p>{presenceLabel(friend.activity)} · {friend.code}</p>
      <div className="mm-apercu-actions">
        <button type="button" className="principal" onClick={() => { setApercu(false); playWithFriends() }}><Gamepad2 aria-hidden="true" />Jouer avec {friend.displayName}</button>
        <button type="button" onClick={() => { setApercu(false); openFriends() }}>Gérer mes amis</button>
      </div>
    </ApercuFlottant> : null}
  </>
}
