import { useEffect, useRef, useState, type ReactNode } from 'react'
import { BarChart3, ChevronRight, History, Lock, Shapes, Trophy, UserPlus, Users } from 'lucide-react'
import { NOM_ABONNEMENT, type EtatAbonnement, type RythmeTheme, type ThemeAbonnement } from '../abonnement'
import type { MatchLobbyState, MatchPace, MatchState } from '../matches'
import { ChronoRecherche } from './ChronoRecherche'
import { playerInitials, type GuestIdentity } from '../playerIdentity'
import { nextRankedDivision, rankImage, rankedDivision, rankedPlacementLabel, RANKED_PLACEMENT_MATCHES } from '../ranked'
import type { RankedMatchmakingState } from '../rankedMatchmaking'
import type { SocialState } from '../social'
import { Avatar, SocialPortrait, presenceLabel } from './MenuChrome'
import { asyncTimeLeft, matchOpponent } from './HomePage'
import { noterOrigineDeLaPartie } from '../transitionPartie'
import { useHauteurAnimee } from './hauteurAnimee'
import { DefinitionEnAttente } from './DefinitionEnAttente'
import { ThemesTab } from './ThemesAbonnement'
import { IconeMotManPlus } from './LogoMotManPlus'
import { Link2 } from 'lucide-react'
import type { RythmeChoisi } from '../matches'
import { libelleDuRythme, rythmeDeLInvitation, SECONDES_DU_TOUR_DE_CHAINE } from '../game/chaineDuTour'

// ─────────────────────────────────────────────────────────────────────────────
// L'ÉCRAN JOUER — quatre onglets, une carte.
//
// Maquette validée par le propriétaire le 16/09/2026. Seule la carte du milieu
// change ; la reprise ne bouge jamais. Les derniers matchs sont au profil depuis
// le 02/11/2026 : la place revient aux modes de jeu.
//
// Les pictogrammes restent les icônes lucide du reste de l'app, colorées par
// mode — vert pin, or, sauge (la terre cuite est rendue à l'adversaire depuis
// le lot D, 22/10/2026) — plutôt que les emojis de la maquette : un
// emoji est multicolore là où la DA est monochrome, et son dessin change d'un
// téléphone à l'autre. Ils sont décoratifs, le libellé à côté porte le sens.
// ─────────────────────────────────────────────────────────────────────────────

export type PlayTabId = 'normal' | 'ranked' | 'friends' | 'themes'

const ONGLETS: Array<{ id: PlayTabId; icone: ReactNode; label: string }> = [
  { id: 'normal', icone: <Trophy />, label: 'Normal' },
  { id: 'ranked', icone: <BarChart3 />, label: 'Classé' },
  { id: 'friends', icone: <Users />, label: 'Amis' },
  // Le quatrième est celui de l'abonnement, visible de tous : c'est sa vitrine.
  { id: 'themes', icone: <Shapes />, label: 'Thèmes' },
]

const MODE_STORAGE_KEY = 'motman-dernier-mode'

/** Le dernier mode LANCÉ, pour rouvrir l'écran là où le joueur l'a laissé. */
function lireDernierMode(): PlayTabId {
  try {
    const range = localStorage.getItem(MODE_STORAGE_KEY)
    if (range === 'normal' || range === 'ranked' || range === 'friends' || range === 'themes') return range
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

/**
 * Avant la première partie : ce qu'il faut savoir pour se lancer. Les derniers
 * matchs ont déménagé au profil le 02/11/2026 (HistoriqueDesParties.tsx).
 */
function PremierePartie() {
  return <div className="mm-recent-history is-visible">
    <section className="mm-recent-history-card">
      <div className="mm-recent-history-empty"><History /><strong>Ta première partie t’attend</strong><small>Une partie dure une dizaine de minutes. Tu as 30 secondes pour lire la grille avant ton premier tour. Une lettre fausse ne coûte aucun point.</small></div>
    </section>
  </div>
}

/** Les deux rythmes, côte à côte. Le même bloc sert à Normal et à Amis. */
function PaceChoice({ pace, setPace, label, avecChaine = false }: { pace: RythmeChoisi | null; setPace: (rythme: RythmeChoisi) => void; label: string; avecChaine?: boolean }) {
  return <div className={`mm-pace-choice ${avecChaine ? 'is-trois' : ''}`} role="group" aria-label={label}>
    <button type="button" className={pace === 'realtime' ? 'active' : ''} aria-pressed={pace === 'realtime'} aria-label="Temps limité, 45 secondes par tour" onClick={() => setPace('realtime')}>
      <strong>Temps limité</strong><small>45 s par tour</small>
    </button>
    <button type="button" className={pace === 'async' ? 'active' : ''} aria-pressed={pace === 'async'} aria-label="Temps illimité, 24 heures par tour" onClick={() => setPace('async')}>
      <strong>Temps illimité</strong><small>24 h par tour</small>
    </button>
    {avecChaine ? <button type="button" className={pace === 'chaine' ? 'active' : ''} aria-pressed={pace === 'chaine'} aria-label={`En chaîne, ${SECONDES_DU_TOUR_DE_CHAINE} secondes par tour`} onClick={() => setPace('chaine')}>
      <strong>En chaîne</strong><small>{SECONDES_DU_TOUR_DE_CHAINE} s par tour</small>
    </button> : null}
  </div>
}

/**
 * Le troisième rythme, celui de l'abonnement : « La partie au calme » (A9,
 * décidée le 15/10/2026). Sur les grilles normales, sans chrono, sans défaite
 * par absence ni récompense. Visible de tous : sans abonnement, le cadenas
 * ouvre la fiche de l'abonnement. Le mot « bot » n'y figure pas (16/10/2026).
 */
function ChoixAuCalme({ choisi, verrouille, choisir }: { choisi: boolean; verrouille: boolean; choisir: () => void }) {
  return <button type="button" className={`mm-pace-calme ${choisi ? 'active' : ''}`} aria-pressed={choisi} aria-label={verrouille ? `Au calme, sans chrono, avec ${NOM_ABONNEMENT}` : 'Au calme, sans chrono'} onClick={choisir}>
    <span className="mm-pace-calme-icone" aria-hidden="true"><IconeMotManPlus taille={30} /></span>
    <span><strong>Au calme</strong><small>Sans chrono, à ton rythme</small></span>
    {verrouille ? <span className="mm-pace-calme-plus" aria-hidden="true"><Lock />{NOM_ABONNEMENT}</span> : null}
  </button>
}

/**
 * Une recherche en cours : la carte se replie sur une seule ligne.
 *
 * Attendre sans compter (15/10/2026, B2) : la recherche normale dure 15 s au
 * plus, puis un bot prend la place. Trois points qui respirent suffisent à dire
 * qu'elle n'est pas bloquée ; les secondes, en rouge, pressaient pour rien. La
 * recherche classée, qui peut durer dix minutes, garde son compteur.
 */
function SearchingCard({ titre, detail, annuler, disabled }: { titre: string; detail: string; annuler: () => void; disabled: boolean }) {
  return <section className="mm-play-card is-searching" aria-live="polite">
    <span className="mm-search-respire" aria-hidden="true"><i /><i /><i /></span>
    <span className="mm-play-searching-copy"><strong>{titre}</strong><small>{detail}</small></span>
    <button type="button" className="mm-search-cancel" disabled={disabled} onClick={annuler}>Annuler</button>
  </section>
}

export function PlayPage({ identity, social, lobby, invite, cancelInvite, searchMatch, cancelSearch, rechercheEnvoyee = false, nouveau = false, openAccount, resumeMatch, openFriends, ranked, rankedBusy, rankedTimedOut, rankedError, startRanked, cancelRanked, initialTab, abonnement, themes, ouvrirOffre, jouerTheme, inviterSurTheme, jouerAuCalme }: {
  identity: GuestIdentity
  social: SocialState
  lobby: MatchLobbyState
  invite: (friendId: string, rythme: RythmeChoisi) => Promise<void>
  cancelInvite: (invitationId: string) => Promise<void>
  searchMatch: (rythme: RythmeChoisi) => Promise<void>
  cancelSearch: (pace: MatchPace) => Promise<void>
  /** Une recherche est partie, y compris depuis « Rejouer », qui ne passe pas par les boutons d'ici. */
  rechercheEnvoyee?: boolean
  /** Aucune partie finie : la carte Normal lui parle de durée, pas de classement (N1). */
  nouveau?: boolean
  /** Un invité touche Classé : « Créer mon compte » au lieu d'un refus (N4). */
  openAccount?: () => void
  resumeMatch: (matchId: string) => void
  openFriends: () => void
  ranked: RankedMatchmakingState
  rankedBusy: boolean
  /** Vrai après une recherche restée sans adversaire (voir rankedSearchExpired). */
  rankedTimedOut: boolean
  rankedError: string | null
  startRanked: () => Promise<void>
  cancelRanked: () => Promise<void>
  /** L'onglet demandé par l'écran d'où l'on vient (un ami touché à l'accueil → Amis). */
  initialTab?: PlayTabId
  abonnement: EtatAbonnement
  themes: readonly ThemeAbonnement[]
  ouvrirOffre: () => void
  jouerTheme: (theme: ThemeAbonnement, rythme: RythmeTheme) => void
  inviterSurTheme: (theme: ThemeAbonnement) => void
  jouerAuCalme: () => void
}) {
  const [onglet, setOnglet] = useState<PlayTabId>(() => initialTab ?? lireDernierMode())
  const [normalPace, setNormalPace] = useState<MatchPace>('realtime')
  const [auCalme, setAuCalme] = useState(false)
  const [friendPace, setFriendPace] = useState<RythmeChoisi>('realtime')
  const [matchBusy, setMatchBusy] = useState<string | null>(null)
  const [searchBusy, setSearchBusy] = useState<MatchPace | null>(null)
  const lancementEnCours = searchBusy !== null || rechercheEnvoyee

  // `find` et non `some` : la carte affiche le temps d'attente, il lui faut donc
  // la recherche elle-même et pas seulement son existence.
  const realtimeSearch = lobby.searches.find(search => search.pace === 'realtime')
  const asyncSearch = lobby.searches.find(search => search.pace === 'async')
  const realtimeSearching = Boolean(realtimeSearch)
  const asyncSearching = Boolean(asyncSearch)
  const normalSearching = realtimeSearching || asyncSearching
  const rankedSearching = ranked.status === 'searching' || ranked.status === 'ready' || ranked.status === 'accepted'
  // La carte du mode change de forme en glissant (H8) : onglet, recherche lancée ou annulée.
  const panneauMode = useRef<HTMLDivElement>(null)
  useHauteurAnimee(panneauMode, `${onglet}|${normalSearching}|${rankedSearching}`)
  const currentRank = rankedDivision(ranked.progress.points, ranked.progress.matches)
  const prochainPalier = nextRankedDivision(ranked.progress.points, ranked.progress.matches)
  const reprise = partieAReprendre(lobby.active, identity.playerId)
  const amisEnLigne = social.friends.filter(friend => friend.online).length
  const invitationEnAttente = lobby.incoming.length > 0
  // On attend quelqu'un : une recherche normale ou classée, ou un ami invité.
  // Une définition à deviner en attendant (B2, 15/10/2026), sous la carte du mode.
  const onAttend = (onglet === 'normal' && normalSearching)
    || (onglet === 'ranked' && ranked.status === 'searching')
    || (onglet === 'friends' && lobby.outgoing.length > 0)

  // Une recherche lancée depuis un autre écran ramène le joueur sur son mode.
  useEffect(() => {
    if (normalSearching || rechercheEnvoyee) setOnglet('normal')
    else if (rankedSearching) setOnglet('ranked')
  }, [normalSearching, rechercheEnvoyee, rankedSearching])

  const choisirOnglet = (id: PlayTabId) => setOnglet(id)

  const lancerRechercheNormale = async (rythme: RythmeChoisi = normalPace) => {
    retenirMode('normal')
    setSearchBusy(rythme === 'async' ? 'async' : 'realtime')
    try { await searchMatch(rythme) } finally { setSearchBusy(null) }
  }

  const arreterRecherche = async (pace: MatchPace) => {
    setSearchBusy(pace)
    try { await cancelSearch(pace) } finally { setSearchBusy(null) }
  }

  return <div className="mm-page mm-play-page">
    <div className={`mm-play-tabs ${ONGLETS.length > 3 ? 'has-plus' : ''}`} role="tablist" aria-label="Mode de jeu">
      {ONGLETS.map(({ id, icone, label }) => <button
        type="button"
        key={id}
        id={`mm-${id}-tab`}
        role="tab"
        className={onglet === id ? 'is-active' : ''}
        aria-selected={onglet === id}
        aria-controls="mm-play-mode"
        aria-label={id === 'friends' && invitationEnAttente ? `${label}, une invitation t’attend` : label}
        onClick={() => choisirOnglet(id)}
      >
        <i aria-hidden="true">{icone}</i>{label}
        {id === 'friends' && invitationEnAttente ? <span className="mm-play-tab-badge" aria-hidden="true" /> : null}
      </button>)}
    </div>

    {reprise ? <button type="button" data-partie-origine={reprise.id} className="mm-play-resume" onClick={event => { noterOrigineDeLaPartie(event.currentTarget, reprise.id); resumeMatch(reprise.id) }}>
      <Avatar label={playerInitials(matchOpponent(reprise, identity.playerId))} small />
      <span className="mm-play-resume-copy">
        <strong>{matchOpponent(reprise, identity.playerId)} · {reprise.currentPlayerId === identity.playerId ? 'à toi' : 'en attente'}</strong>
        <small>{reprise.pace === 'async' ? `Illimité · ${asyncTimeLeft(reprise)}` : reprise.chaine ? 'En chaîne' : 'Temps limité'}</small>
      </span>
      <span className="mm-play-resume-go">Reprendre</span>
    </button> : null}

    <div ref={panneauMode} id="mm-play-mode" className="mm-play-mode" role="tabpanel" aria-labelledby={`mm-${onglet}-tab`}>
      {onglet === 'normal' ? (normalSearching
        ? <SearchingCard
          titre="On te trouve un adversaire…"
          detail={asyncSearching ? 'Tu peux revenir plus tard' : realtimeSearch?.variante === 'chaine' ? 'En chaîne · prends le temps de t’installer' : 'Prends le temps de t’installer'}
          disabled={searchBusy !== null}
          annuler={() => void arreterRecherche(asyncSearching ? 'async' : 'realtime')}
        />
        : <>
          <section className="mm-play-card">
            <header>
              <span className="mm-play-card-icon" aria-hidden="true"><Trophy /></span>
              <span><h2>Normal</h2><small>{nouveau ? 'Un adversaire en quelques secondes · une dizaine de minutes' : 'Adversaire au hasard · sans classement'}</small></span>
            </header>
            <PaceChoice pace={auCalme ? null : normalPace} setPace={rythme => { if (rythme !== 'chaine') { setAuCalme(false); setNormalPace(rythme) } }} label="Choisir le rythme de la partie" />
            <ChoixAuCalme choisi={auCalme} verrouille={!abonnement.actif} choisir={() => abonnement.actif ? setAuCalme(true) : ouvrirOffre()} />
            <button type="button" className="mm-play-cta" aria-label={auCalme ? 'Jouer une partie au calme' : 'Jouer une partie normale'} disabled={lancementEnCours} onClick={() => auCalme ? jouerAuCalme() : void lancerRechercheNormale()}>
              Jouer <ChevronRight />
            </button>
          </section>
          {/* LE DUEL EN CHAÎNE (02/11/2026, demande du propriétaire) : sa propre carte,
              pas un troisième rythme. Le mode reste une propriété de la partie. */}
          <section className="mm-play-card">
            <header>
              <span className="mm-play-card-icon" aria-hidden="true"><Link2 /></span>
              <span><h2>En chaîne</h2><small>{SECONDES_DU_TOUR_DE_CHAINE} s pour poser le plus de lettres · une erreur et ça passe</small></span>
            </header>
            <button type="button" className="mm-play-cta" aria-label="Jouer une partie en chaîne" disabled={lancementEnCours} onClick={() => void lancerRechercheNormale('chaine')}>
              Jouer <ChevronRight />
            </button>
          </section>
        </>) : null}

      {onglet === 'ranked' ? <section className="mm-play-card is-gold">
        <header>
          <span className="mm-play-card-icon" aria-hidden="true"><BarChart3 /></span>
          <span><h2>Classé</h2><small>45 s par tour · adversaire de rang proche</small></span>
        </header>
        {/* L'INVITÉ ET LE CLASSÉ (22/10/2026, N4). Il touchait « Jouer » et
            recevait un refus qui l'envoyait chercher « Menu → Compte ». 29 comptes
            sur 43 sont des invités, et le classé est un pilier du jeu. */}
        {identity.accountType !== 'account' ? <div className="mm-ranked-compte">
          <p>Le classé se joue avec un compte : c’est gratuit, ça prend une minute, et ta progression est gardée.</p>
          {openAccount ? <button type="button" className="mm-play-cta is-gold" onClick={openAccount}>Créer mon compte <ChevronRight /></button> : null}
        </div> : <>
        <div className="mm-ranked-status">
          <img src={rankImage(currentRank)} alt="" />
          {/* « Classement établi » n'apprenait rien une fois les placements
              faits : la distance au palier suivant, comme au Classement. */}
          <span><small>Ton rang</small><strong>{currentRank.label}</strong><b>{ranked.progress.matches < RANKED_PLACEMENT_MATCHES ? rankedPlacementLabel(ranked.progress.matches) : prochainPalier ? `${prochainPalier.minimum - ranked.progress.points} pt avant ${prochainPalier.label}` : 'Rang maximum'}</b></span>
          {ranked.progress.matches >= 5 ? <em>{ranked.progress.points} pt</em> : null}
        </div>
        {rankedSearching
          ? <div className="mm-play-searching-inline" aria-live="polite">
            <ChronoRecherche depuis={ranked.queuedAt} />
            <span>Recherche classée en cours</span>
            <button type="button" className="mm-search-cancel" disabled={rankedBusy || ranked.status === 'accepted'} onClick={() => void cancelRanked()}>Annuler</button>
          </div>
          : <button type="button" className="mm-play-cta is-gold" aria-label="Jouer une partie classée" disabled={rankedBusy || ranked.status === 'started'} onClick={() => { retenirMode('ranked'); void startRanked() }}>
            {ranked.status === 'started' ? 'Partie classée en cours' : 'Jouer'} <ChevronRight />
          </button>}
        {rankedTimedOut && !rankedSearching ? <p className="mm-ranked-timeout" role="status">
          Personne n’a été trouvé en dix minutes — la recherche s’est arrêtée. Tu peux la relancer.
        </p> : null}
        <p className="mm-ranked-explainer">Tu peux jouer ailleurs pendant la recherche : on te prévient dès qu’un adversaire est trouvé.</p>
        </>}
        {rankedError ? <p className="mm-social-error" role="alert">{rankedError}</p> : null}
      </section> : null}

      {onglet === 'themes' ? <ThemesTab abonnement={abonnement} themes={themes} ouvrirOffre={ouvrirOffre} jouerTheme={(theme, rythme) => { retenirMode('themes'); jouerTheme(theme, rythme) }} inviterSurTheme={inviterSurTheme} /> : null}

      {onglet === 'friends' ? <>
        <section className="mm-play-card is-sage">
          <header>
            <span className="mm-play-card-icon" aria-hidden="true"><Users /></span>
            <span><h2>Amis</h2><small>{amisEnLigne ? `${amisEnLigne} ami${amisEnLigne > 1 ? 's' : ''} en ligne` : 'Invite un proche à une partie'}</small></span>
          </header>
          <PaceChoice pace={friendPace} setPace={setFriendPace} label="Choisir le rythme de la partie entre amis" avecChaine />
        </section>

        <div className="mm-play-friends">
        {/* UNE LIGNE PAR AMI. L'invitation envoyée avait sa propre ligne, avec
            des initiales à la place du portrait, AU-DESSUS de celle de l'ami :
            le même joueur apparaissait deux fois, comme deux profils (relevé
            par le propriétaire le 18/09/2026). Elle vit maintenant dans la
            ligne de l'ami. Seule une invitation vers quelqu'un qui n'est plus
            dans la liste garde une ligne à elle, pour rester annulable. */}
        {lobby.outgoing.filter(invitation => !social.friends.some(friend => friend.playerId === invitation.guestId)).map(invitation => <div className="mm-friend-line is-waiting" key={invitation.id}>
          <Avatar label={playerInitials(invitation.guest?.displayName ?? 'A')} small />
          <span className="mm-friend-line-copy">
            <strong>{invitation.guest?.displayName ?? 'Ton ami'}</strong>
            <small>{libelleDuRythme(rythmeDeLInvitation(invitation))} · invitation envoyée…</small>
          </span>
          <button type="button" disabled={matchBusy !== null} onClick={async () => { setMatchBusy(invitation.id); await cancelInvite(invitation.id); setMatchBusy(null) }}>Annuler</button>
        </div>)}

        {social.friends.map(friend => {
          const invitation = lobby.outgoing.find(candidate => candidate.guestId === friend.playerId)
          const injoignable = friendPace !== 'async' && (!friend.online || friend.activity === 'playing')
          return <div className={`mm-friend-line ${friend.online ? '' : 'is-offline'} ${invitation ? 'is-waiting' : ''}`} key={friend.playerId}>
            <span className="mm-home-friend-avatar"><SocialPortrait user={friend} small /><i className={friend.activity} /></span>
            <span className="mm-friend-line-copy">
              <strong>{friend.displayName}</strong>
              <small>{invitation
                // L'essentiel d'abord : la ligne est étroite et se coupe à droite.
                ? `Invitation envoyée · ${libelleDuRythme(rythmeDeLInvitation(invitation)).toLowerCase()}`
                : injoignable ? `${presenceLabel(friend.activity)} · invitation en illimité` : presenceLabel(friend.activity)}</small>
            </span>
            {invitation
              ? <button
                type="button"
                disabled={matchBusy !== null}
                aria-label={`Annuler l’invitation à ${friend.displayName}`}
                onClick={async () => { setMatchBusy(invitation.id); await cancelInvite(invitation.id); setMatchBusy(null) }}
              >Annuler</button>
              : <button
                type="button"
                disabled={injoignable || matchBusy !== null}
                aria-label={`Inviter ${friend.displayName}`}
                onClick={async () => { retenirMode('friends'); setMatchBusy(friend.playerId); await invite(friend.playerId, friendPace); setMatchBusy(null) }}
              >{friendPace !== 'async' && friend.activity === 'playing' ? 'En jeu' : 'Inviter'}</button>}
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

    {onAttend ? <DefinitionEnAttente /> : null}

    {onglet === 'themes' || lobby.recent.length ? null : <PremierePartie />}
  </div>
}
