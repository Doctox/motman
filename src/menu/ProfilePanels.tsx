import { useEffect, useState, type ReactNode } from 'react'
import { BarChart3, ChevronRight, Feather, Gamepad2, Home, Pencil, Trophy, User, X } from 'lucide-react'
import { CosmeticPortrait } from '../CosmeticPortrait'
import { getAnimation, getAvatar, getFrame, type PlayerCosmetics } from '../cosmetics'
import { PLAYER_NAME_MAX_LENGTH, validatePlayerName } from '../playerNamePolicy'
import { shortPlayerId, type GuestIdentity } from '../playerIdentity'
import { experienceGoalForLevel, MAX_PLAYER_LEVEL, type PlayerProgress } from '../playerProgress'
import { rankImage, rankedDivision } from '../ranked'
import { EMPTY_PLAYER_STATS, loadPlayerStats, type PlayerStats } from '../playerStats'
import { loadRankedLeaderboard, type RankedLeaderboard } from '../rankedMatchmaking'
import { useDialogFocus } from '../useDialogFocus'
import { DailyLeaderboardPanel } from './DailyChallenge'
import { RankProgress, SocialPortrait } from './MenuChrome'
import type { MenuPage } from './types'

const frenchNumber = new Intl.NumberFormat('fr-FR')

export function RankingPage({ identity, progress, cosmetics }: { identity: GuestIdentity; progress: PlayerProgress; cosmetics: PlayerCosmetics }) {
  // DEUX ÉPREUVES, deux classements, et il faut choisir laquelle on regarde.
  //
  // Le classé demande une rencontre : deux humains au même instant. Le défi du
  // jour, non — tout le monde joue la même grille, chacun quand il veut. Ce
  // sont deux compétitions de nature différente, et les mélanger dans une même
  // liste n'aurait aucun sens. D'où ce premier sélecteur, au-dessus du
  // Général/Amis qui existait déjà et qui ne concerne que le classé.
  //
  // La progression de rang ne s'affiche qu'avec le classé : elle n'a rien à
  // voir avec le défi du jour.
  const [epreuve, setEpreuve] = useState<'ranked' | 'daily'>('ranked')
  const [tab, setTab] = useState<'general' | 'friends'>('general')
  const [leaderboard, setLeaderboard] = useState<RankedLeaderboard>({ general: [], friends: [] })
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let active = true
    setLoading(true)
    void loadRankedLeaderboard()
      .then(next => { if (active) setLeaderboard(next) })
      .catch(() => { if (active) setLeaderboard({ general: [], friends: [] }) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [progress.rankedMatches, progress.rankedPoints])
  const entries = leaderboard[tab]
  return <div className="mm-page mm-ranking-page">
    <div className="mm-segmented mm-ranking-epreuve" role="group" aria-label="Épreuve">
      <button type="button" className={epreuve === 'ranked' ? 'active' : ''} aria-pressed={epreuve === 'ranked'} onClick={() => setEpreuve('ranked')}>Classé</button>
      <button type="button" className={epreuve === 'daily' ? 'active' : ''} aria-pressed={epreuve === 'daily'} onClick={() => setEpreuve('daily')}>Défi du jour</button>
    </div>
    {epreuve === 'daily' ? <DailyLeaderboardPanel /> : <>
    <RankProgress progress={progress} compact />
    <div className="mm-segmented" role="group" aria-label="Type de classement"><button type="button" className={tab === 'general' ? 'active' : ''} aria-pressed={tab === 'general'} onClick={() => setTab('general')}>Général</button><button type="button" className={tab === 'friends' ? 'active' : ''} aria-pressed={tab === 'friends'} onClick={() => setTab('friends')}>Amis</button></div>
    <section className="mm-leaderboard">
      {!entries.length && tab === 'general' && progress.rankedMatches >= 5 ? <div className="mm-ranking-row you">
        <span className="mm-position">—</span><CosmeticPortrait avatarId={cosmetics.equippedAvatarId} frameId={cosmetics.equippedFrameId} animationId={cosmetics.equippedAnimationId} alt="" small /><strong>{identity.displayName}<small>Vous</small></strong><b>{progress.rankedPoints} <small>pt</small></b>
      </div> : null}
      {entries.map(entry => {
        const division = rankedDivision(entry.points, entry.matches)
        const mine = entry.user.playerId === identity.playerId
        return <div className={`mm-ranking-row ${mine ? 'you' : ''}`} key={entry.user.playerId}>
          <span className={`mm-position ${entry.position <= 3 ? `p${entry.position}` : ''}`}>{entry.position}</span>
          <SocialPortrait user={entry.user} small />
          <strong>{entry.user.displayName}<small>{mine ? 'Vous' : `${entry.wins} victoire${entry.wins > 1 ? 's' : ''}`}</small></strong>
          <span className="mm-ranking-rank"><img src={rankImage(division)} alt="" /><b>{entry.points} <small>pt</small></b></span>
        </div>
      })}
      {!entries.length ? <div className="mm-empty-ranking"><Trophy /><strong>{loading ? 'Chargement du classement…' : tab === 'general' ? progress.rankedMatches < 5 ? 'Placements en cours' : 'Aucun joueur classé' : 'Aucun ami classé'}</strong><span>{loading ? 'Les meilleurs joueurs arrivent.' : tab === 'general' ? progress.rankedMatches < 5 ? `Encore ${5 - progress.rankedMatches} partie${5 - progress.rankedMatches > 1 ? 's' : ''} de placement.` : 'Soyez le premier à terminer vos cinq placements.' : 'Vos amis apparaîtront ici après leurs placements.'}</span></div> : null}
    </section>
    </>}
  </div>
}


// ─────────────────────────────────────────────────────────────────────────────
// « VOS PARTIES ».
//
// Le profil ne parlait que de progression — niveau, XP, points de classé — et
// jamais du fait de jouer. Tout était pourtant en base depuis le premier jour.
//
// Les abandons sont comptés A PART, ni en victoires ni en défaites : partir
// n'est pas perdre, et les ranger avec les défaites serait un jugement que le
// jeu n'a pas à porter. Ils restent dans le total, donc dans le dénominateur du
// taux — sinon on pourrait gonfler son taux en quittant les parties mal
// engagées.
//
// Le record ne vaut que sur 90 jours et le dit : au-delà, l'archivage ne garde
// que des sommes, pas le meilleur d'une partie. Mieux vaut une mention discrète
// qu'un chiffre qu'on croit être un record de toujours.
// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ IL EXISTAIT UN AUTRE BLOC « Victoires / Défaites » sur cette page, nourri
// par `player_progress.wins/losses`. Il a été retiré, et il ne doit pas
// revenir : ce compteur RANGE LES ABANDONS AVEC LES DÉFAITES. Vérifié en
// production sur les cinq joueurs concernés — son total de défaites égale
// exactement `défaites + abandons` de l'historique. Afficher les deux blocs
// montrerait donc deux nombres de défaites différents sur le même écran.
//
// On garde celui-ci, qui distingue les deux et le dit.
function PlayerStatsPanel() {
  const [stats, setStats] = useState<PlayerStats>(EMPTY_PLAYER_STATS)
  const [chargement, setChargement] = useState(true)
  useEffect(() => {
    let vivant = true
    loadPlayerStats()
      .then(next => { if (vivant) setStats(next) })
      .catch(() => { if (vivant) setStats(EMPTY_PLAYER_STATS) })
      .finally(() => { if (vivant) setChargement(false) })
    return () => { vivant = false }
  }, [])

  if (chargement) return null
  if (stats.played === 0) {
    return <section className="mm-player-stats is-empty">
      <h2><Gamepad2 aria-hidden="true" />Vos parties</h2>
      <p>Vos statistiques apparaîtront après votre première partie terminée.</p>
    </section>
  }

  return <section className="mm-player-stats" aria-label="Vos statistiques de jeu">
    <h2><Gamepad2 aria-hidden="true" />Vos parties</h2>
    <dl>
      <div><dt>Jouées</dt><dd>{frenchNumber.format(stats.played)}</dd></div>
      <div><dt>Victoires</dt><dd>{frenchNumber.format(stats.wins)}</dd></div>
      <div><dt>Taux</dt><dd>{stats.winRate ?? 0} %</dd></div>
      <div><dt>Grilles finies</dt><dd>{frenchNumber.format(stats.completed)}</dd></div>
    </dl>
  </section>
}

export function ProfilePage({ identity, progress, cosmetics, edit, openAccount }: { identity: GuestIdentity; progress: PlayerProgress; cosmetics: PlayerCosmetics; edit: () => void; openAccount: () => void }) {
  const xpGoal = experienceGoalForLevel(progress.level)
  const xpPercent = progress.level >= MAX_PLAYER_LEVEL ? 100 : Math.min(100, progress.xp / xpGoal * 100)
  const equippedTitle = progress.titles.find(title => title.id === progress.equippedTitleId)
  return <div className="mm-page mm-profile-page">
    <section className="mm-profile-hero"><CosmeticPortrait avatarId={cosmetics.equippedAvatarId} frameId={cosmetics.equippedFrameId} animationId={cosmetics.equippedAnimationId} alt="Votre avatar" /><div><h1>{identity.displayName}</h1>{equippedTitle ? <small className="mm-equipped-title">{equippedTitle.name}</small> : null}<button type="button" onClick={edit}><Pencil />Modifier</button></div></section>
    <section className="mm-level"><div><BarChart3 /><strong>Niveau {progress.level}</strong><span>{progress.level >= MAX_PLAYER_LEVEL ? 'Niveau maximum' : `Niveau ${progress.level + 1}`}</span></div><i className="guest-progress"><b style={{ width: `${xpPercent}%` }} /></i><p>{progress.level >= MAX_PLAYER_LEVEL ? <strong>Niveau maximum atteint</strong> : <><strong>{progress.xp}</strong> / {xpGoal} XP</>}</p></section>
    <PlayerStatsPanel />
    {/* La bourse, et plus l'entrée de l'Épicerie : celle-ci a son onglet depuis
        qu'elle est dans la barre du bas. Le solde reste ici parce qu'il n'a rien
        d'une navigation — c'est ce que le joueur possède, à sa place sur son
        profil, et il ne se lit nulle part ailleurs hors de la boutique. */}
    <section className="mm-purse" aria-label={`Votre bourse : ${cosmetics.plumes} plumes`}>
      <span className="mm-purse-icon" aria-hidden="true"><Feather /></span>
      <span className="mm-purse-copy">
        <small>Votre bourse</small>
        <strong>{frenchNumber.format(cosmetics.plumes)} plume{cosmetics.plumes > 1 ? 's' : ''}</strong>
      </span>
    </section>
    <button type="button" className="mm-account" onClick={openAccount}><User /><span><strong>{identity.accountType === 'account' ? 'Compte connecté' : 'Compte invité'}</strong><small>Code ami {identity.friendCode ?? shortPlayerId(identity.playerId)}</small></span><b>{identity.accountType === 'account' ? 'Gérer' : 'Créer un compte'}</b><ChevronRight /></button>
  </div>
}

export function QuickMenu({ page, navigate, close }: { page: MenuPage; navigate: (page: MenuPage) => void; close: () => void }) {
  const items: Array<[MenuPage, string, ReactNode]> = [
    ['home', 'Accueil', <Home />], ['play', 'Jouer', <Gamepad2 />],
    ['ranking', 'Classement', <BarChart3 />], ['profile', 'Profil', <User />],
  ]
  const dialogRef = useDialogFocus<HTMLElement>(close)
  return <div className="mm-modal-layer mm-quick-menu-layer" role="presentation" onMouseDown={event => event.target === event.currentTarget && close()}>
    <section ref={dialogRef} className="mm-quick-menu" role="dialog" aria-modal="true" aria-label="Menu principal" tabIndex={-1}>
      <header><h2>Menu</h2><button type="button" aria-label="Fermer" onClick={close}><X /></button></header>
      <nav>{items.map(([id, label, icon]) => <button type="button" className={page === id ? 'active' : ''} aria-current={page === id ? 'page' : undefined} onClick={() => { navigate(id); close() }} key={id}>{icon}<span>{label}</span><ChevronRight /></button>)}</nav>
    </section>
  </div>
}

export function EditGuestPanel({ identity, progress, cosmetics, close, save }: {
  identity: GuestIdentity
  progress: PlayerProgress
  cosmetics: PlayerCosmetics
  close: () => void
  save: (displayName: string, avatarId: string, frameId: string, animationId: string, titleId: string | null) => Promise<void>
}) {
  const [displayName, setDisplayName] = useState(identity.displayName)
  const [avatarId, setAvatarId] = useState(cosmetics.equippedAvatarId)
  const [frameId, setFrameId] = useState(cosmetics.equippedFrameId)
  const [animationId, setAnimationId] = useState(cosmetics.equippedAnimationId)
  const [titleId, setTitleId] = useState<string | null>(progress.equippedTitleId)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameValidation = validatePlayerName(displayName)
  const normalized = nameValidation.normalized
  const dialogRef = useDialogFocus<HTMLFormElement>(close)
  return <div className="mm-modal-layer" role="presentation" onMouseDown={event => event.target === event.currentTarget && close()}>
    <form ref={dialogRef} className="mm-guest-editor mm-profile-editor" role="dialog" aria-modal="true" aria-label="Modifier le profil invité" tabIndex={-1} onSubmit={event => {
      event.preventDefault()
      if (!nameValidation.valid || busy) return
      setBusy(true); setError(null)
      void save(normalized, avatarId, frameId, animationId, titleId).catch(reason => setError(reason instanceof Error ? reason.message : 'Enregistrement impossible.')).finally(() => setBusy(false))
    }}>
      <header><div><small>Votre identité</small><h2>Modifier le profil</h2></div><button type="button" onClick={close} aria-label="Fermer"><X /></button></header>
      <div className="mm-guest-preview"><CosmeticPortrait avatarId={avatarId} frameId={frameId} animationId={animationId} alt="Aperçu de votre avatar" /><span><strong>{normalized || 'Votre pseudo'}</strong><small>{progress.titles.find(title => title.id === titleId)?.name ?? `ID ${shortPlayerId(identity.playerId)}`}</small></span></div>
      <div className="mm-profile-editor-scroll">
      <label htmlFor="guest-display-name">Pseudo</label>
      <input id="guest-display-name" value={displayName} maxLength={PLAYER_NAME_MAX_LENGTH} autoComplete="nickname" aria-invalid={!nameValidation.valid} aria-describedby="guest-display-name-help" onChange={event => setDisplayName(event.target.value)} />
      <p id="guest-display-name-help" className={`mm-name-help ${nameValidation.valid ? 'valid' : 'invalid'}`} role="status">
        {nameValidation.valid ? `${Array.from(normalized).length}/${PLAYER_NAME_MAX_LENGTH}` : nameValidation.error}
      </p>
      <fieldset><legend>Avatar</legend><div className="mm-owned-avatar-grid">{cosmetics.ownedAvatarIds.map(id => {
        const avatar = getAvatar(id)
        return <button type="button" className={avatarId === id ? 'active' : ''} aria-pressed={avatarId === id} onClick={() => setAvatarId(id)} key={id}><CosmeticPortrait avatarId={id} frameId="cadre-ivoire" alt={avatar.name} /><span>{avatar.name}</span></button>
      })}</div></fieldset>
      <fieldset><legend>Cadre</legend><div className="mm-owned-frame-grid">{cosmetics.ownedFrameIds.map(id => {
        const frame = getFrame(id)
        return <button type="button" className={frameId === id ? 'active' : ''} aria-pressed={frameId === id} onClick={() => setFrameId(id)} key={id}><CosmeticPortrait avatarId={avatarId} frameId={id} alt={frame.name} /><span>{frame.name}</span></button>
      })}</div></fieldset>
      <fieldset><legend>Animation</legend><div className="mm-owned-animation-grid">{cosmetics.ownedAnimationIds.map(id => {
        const animation = getAnimation(id)
        return <button type="button" className={animationId === id ? 'active' : ''} aria-pressed={animationId === id} onClick={() => setAnimationId(id)} key={id}><CosmeticPortrait avatarId={avatarId} frameId={frameId} animationId={id} alt={animation.name} /><span>{animation.name}</span></button>
      })}</div></fieldset>
      <fieldset><legend>Titre</legend><div className="mm-owned-title-grid">
        <button type="button" className={titleId === null ? 'active' : ''} aria-pressed={titleId === null} onClick={() => setTitleId(null)}><strong>Sans titre</strong><small>Profil épuré</small></button>
        {progress.titles.map(title => <button type="button" disabled={!title.unlocked} className={titleId === title.id ? 'active' : ''} aria-pressed={titleId === title.id} onClick={() => title.unlocked && setTitleId(title.id)} key={title.id}><strong>{title.name}</strong><small>{title.unlocked ? title.description : title.unlockType === 'level' ? `Niveau ${title.requiredValue}` : 'Classement'}</small></button>)}
      </div></fieldset>
      {error ? <p className="mm-account-error" role="alert">{error}</p> : null}
      </div>
      <button className="mm-save-guest" type="submit" disabled={!nameValidation.valid || busy}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
    </form>
  </div>
}

