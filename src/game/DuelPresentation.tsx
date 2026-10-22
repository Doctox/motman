import { useEffect, useState, type CSSProperties } from 'react'
import { BellRing, Check, Gamepad2, Hourglass, House, RotateCcw, UserPlus, X } from 'lucide-react'
import { CosmeticPortrait } from '../CosmeticPortrait'
import { dailyThemeFor } from '../dailyThemeSchedule'
import { dailyResultForMatch, recordDailyResult, type DailyAdvanceEffects } from '../dailyChallenge'
import { GameResultScreen } from '../GameResultScreen'
import { dailyShareText, saveDailyShare, type DailyShareInput } from '../dailyShare'
import { loadDailyLeaderboard } from '../dailyLeaderboard'
import { DailyStreakReward } from '../menu/DailyChallenge'
import { DailyShareButton } from '../menu/DailyShareButton'
import {
  acknowledgeMatchResult,
  type MatchPace,
  type MatchState,
  type PendingMatchResult,
} from '../matches'
import type { ExperienceAward } from '../playerProgress'
import { nextRankedDivision, rankImage, rankedDivision, rankedPlacementLabel, RANKED_PLACEMENT_MATCHES } from '../ranked'
import { raisonSansPoints } from '../menu/classementEnClair'
import { useQuestBoard, type QuestBoard } from '../questBoardState'
import { carteDeNotificationsAMontrer, lireReponseCarte, noterReponseCarte } from '../demandeNotifications'
import { haptic, motionReduced, playEffect } from '../sensoryPreferences'
import { useDialogFocus } from '../useDialogFocus'
import { useCountUp } from './countUp'
import { recompenseDuMatch } from './matchRewardPrefetch'
import { loadSocialState, sendFriendRequestToPlayer } from '../social'
import './duel-friend.css'
import { dailyNote } from '../dailyScore'

// Défi du jour : la série est enregistrée UNE SEULE FOIS par match terminé.
// L'écran de résultat peut être remonté (retour arrière, reprise, StrictMode) et
// chaque appel à recordDailyResult compte une tentative de plus : ce garde-fou de
// module évite de gonfler le compteur du jour pour une seule partie jouée.
const recordedDailyMatches = new Set<string>()

/**
 * Abandon du défi du jour depuis la fenêtre « Quitter » : on sort aussitôt, sans
 * écran de fin, qui l'aurait enregistré. On le fait donc ici — l'accueil passe à
 * « Défi abandonné » et la série compte le jour (règles du 19/09/2026). Même
 * garde-fou que l'écran de fin : un match n'est compté qu'une fois.
 */
export function recordDailyAbandon(match: Pick<MatchState, 'id' | 'isDaily' | 'dailyDate' | 'gridId'>): void {
  if (!match.isDaily || !match.dailyDate || recordedDailyMatches.has(match.id)) return
  recordedDailyMatches.add(match.id)
  try {
    recordDailyResult({ day: match.dailyDate, result: 'abandon', gridId: match.gridId, theme: dailyThemeFor(match.dailyDate) })
  } catch {
    recordedDailyMatches.delete(match.id)
  }
}

/**
 * La taille du pseudo suit sa longueur (13/10/2026) : gros quand il tient,
 * plus serré sinon. Une taille unique devait être petite pour tout le monde,
 * sans quoi « Invité 9558 » se coupait en « Invité 9… ».
 */
export function longueurDuPseudo(nom: string): 'court' | 'moyen' | 'long' | 'tres-long' {
  const lettres = [...nom].length
  return lettres <= 6 ? 'court' : lettres <= 8 ? 'moyen' : lettres <= 11 ? 'long' : 'tres-long'
}

export function DuelPlayer({ name, score, active, initials, avatarId, frameId, animationId, player, detail, title }: { name: string; score: number; active: boolean; initials: string; avatarId?: string; frameId?: string; animationId?: string; player?: boolean; detail?: string; title?: string | null }) {
  // Le chiffre défile ; la CLÉ reste sur la cible, pour que le petit rebond
  // `scoreSettle` joue une fois par gain et non à chaque image du défilement.
  const affiche = useCountUp(score)
  return <div className={`player ${active ? 'active' : ''} ${player ? 'player-you' : ''} ${title ? 'has-title' : ''}`}>{avatarId ? <CosmeticPortrait avatarId={avatarId} frameId={frameId ?? 'cadre-ivoire'} animationId={animationId} alt="" className="game-portrait" /> : <span className="avatar">{initials}</span>}<span><small data-longueur={longueurDuPseudo(name)}>{name}</small>{detail ? <em>{detail}</em> : null}<strong className="score-value" key={score}>{affiche}</strong>{title ? <i className="player-title"><span>{title}</span></i> : null}</span></div>
}

/**
 * Une partie perdue par absence (règle du 18/09/2026, src/gameRules.ts) : un
 * tour de 24 h laissé passer en illimité, ou « Tu es toujours là ? » resté sans
 * réponse 30 s en temps limité.
 */
function absenceDetail(pace: string, won: boolean, opponentName: string): string {
  // Le joueur absent n'est pas grondé (15/10/2026, E1) : il apprend ce qui
  // s'est passé, pas qu'il a fauté.
  // F4 (22/10/2026) : côté absent, on nomme le gagnant et on dit que la partie
  // compte, gentiment. Le 0–0 seul ne disait ni qui gagnait ni l'enjeu.
  if (pace === 'async') return won ? `${opponentName} n’a pas joué en 24 h : victoire par abandon.` : `${opponentName} remporte la partie : elle s’est arrêtée après 24 h sans coup de ta part. Elle compte comme une défaite.`
  return won ? `${opponentName} ne répondait plus : victoire par abandon.` : `${opponentName} remporte la partie : elle s’est arrêtée pendant ta pause. Elle compte comme une défaite.`
}

/** La partie normale close d'office quand un joueur rejoint un match classé confirmé. */
const DETAIL_BASCULE_CLASSEE = 'Une partie classée a commencé : celle-ci s’arrête là, sans gagnant. Rien n’est gagné ni perdu.'

/**
 * REJOUER CONTRE UN AMI (26/09/2026).
 *
 * « Ce serait pas mal que sur la page de fin, on puisse rejouer un match
 * lorsqu'on a joué un match avec un ami. » L'écran de fin savait déjà RECEVOIR
 * une revanche (MultiplayerGame.tsx) ; il sait maintenant la proposer.
 *
 * `attente` porte l'identifiant de l'invitation partie : l'écran de jeu guette
 * la partie qu'elle crée, et y entre dès que l'ami accepte.
 */
export type EtatRevanche =
  | { etape: 'libre' }
  | { etape: 'envoi' }
  | { etape: 'attente'; invitationId: string }
  | { etape: 'sans-reponse' }

export type Revanche = {
  etat: EtatRevanche
  erreur: string | null
  proposer: () => void
  annuler: () => void
}

export function ResultPanel({ match, playerId, opponentName, onExit, onHome, revanche, rejouer, rejouerClassee }: {
  match: MatchState
  playerId: string
  opponentName: string
  onExit: () => void
  onHome: () => void
  revanche?: Revanche
  /** « Rejouer » : la même recherche, au même rythme (N3, 22/10/2026). */
  rejouer?: (pace: MatchPace) => void
  /** « Rejouer en classée » : la file classée, sans détour (C2, 22/10/2026). */
  rejouerClassee?: () => void
}) {
  const [leaving, setLeaving] = useState(false)
  const [leavingError, setLeavingError] = useState<string | null>(null)
  const [experienceAward, setExperienceAward] = useState<ExperienceAward | null | undefined>(undefined)
  const [dailyEffects, setDailyEffects] = useState<DailyAdvanceEffects | null>(null)
  const [dailyShare, setDailyShare] = useState<string | null>(null)
  const won = match.winnerId === playerId
  const administrativeDraw = match.finishReason === 'ranked_transfer'
  const draw = match.winnerId === null && (match.finishReason === 'completed' || administrativeDraw)
  // Espace fine insécable avant « ! » : avec une grande police système, le « ! »
  // passait seul à la ligne (22/10/2026).
  const title = administrativeDraw ? 'Partie mise de côté' : draw ? 'Égalité\u202f!' : won ? 'Victoire\u202f!' : 'Partie terminée'
  const detail = administrativeDraw
    ? DETAIL_BASCULE_CLASSEE
    : match.finishReason === 'timeout'
    ? absenceDetail(match.pace, won, opponentName)
    : match.finishReason === 'forfeit'
      ? won ? `${opponentName} a quitté la partie.` : 'Tu as abandonné la partie.'
      : draw ? 'Tu termines avec le même score.' : won ? 'Tu as rempli la grille avec le meilleur score.' : `${opponentName} remporte cette grille.`
  // Défi du jour abandonné (bouton ou absence) : fermé jusqu'à minuit (19/09/2026).
  const detailDuDefi = match.isDaily && dailyResultForMatch(match, playerId) === 'abandon'
    ? `${detail} Le défi revient demain.`
    : detail
  const leaveResult = async (destination: () => void) => {
    if (leaving) return
    setLeaving(true)
    setLeavingError(null)
    try {
      await acknowledgeMatchResult(playerId, { matchId: match.id })
      destination()
    } catch (reason) {
      setLeavingError(reason instanceof Error ? reason.message : 'Le résultat n’a pas pu être validé.')
      setLeaving(false)
    }
  }
  useEffect(() => {
    let active = true
    // Demandée dès la fin de partie (matchRewardPrefetch.ts) : souvent déjà là.
    void recompenseDuMatch(match.id).then(award => {
      if (active) setExperienceAward(award)
    }).catch(() => { if (active) setExperienceAward(null) })
    haptic(won ? [18, 32, 18, 55, 28] : 24)
    playEffect(won ? 'word' : 'score')
    const reduceMotion = motionReduced()
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' })
    return () => { active = false }
  }, [match.id, won])
  // ── Défi du jour : enregistrement de la SÉRIE (état local) ─────────────────
  // `isDaily` / `dailyDate` sont posés PAR LE SERVEUR à la création du match
  // (action 'daily'). Tant que l'edge function n'est pas déployée, ils sont
  // absents : ce bloc ne fait alors strictement rien et l'écran de fin reste
  // identique. Aucune plume n'est versée ici — les 250 de la première victoire du
  // jour sont versées par le serveur (server_award_feathers), sans quoi le
  // rafraîchissement de compte écraserait un crédit local.
  useEffect(() => {
    if (!match.isDaily || !match.dailyDate) return
    if (recordedDailyMatches.has(match.id)) return
    recordedDailyMatches.add(match.id)
    try {
      const { effects, attempts } = recordDailyResult({
        day: match.dailyDate,
        // Même règle de victoire que le serveur : une partie interrompue n'est
        // pas une victoire (cf. dailyResultForMatch).
        result: dailyResultForMatch({ winnerId: match.winnerId, finishReason: match.finishReason }, playerId),
        gridId: match.gridId,
        // Le thème annoncé ce jour-là par le calendrier (null un jour générique).
        theme: dailyThemeFor(match.dailyDate),
      })
      setDailyEffects(effects)
      // Le résultat à partager, calculé une fois et gardé pour l'accueil.
      const jour = match.dailyDate
      const partage: DailyShareInput = {
        theme: dailyThemeFor(jour),
        outcome: match.winnerId === playerId ? 'win' : match.winnerId === null && match.finishReason === 'completed' ? 'draw' : 'loss',
        // LA NOTE DU CLASSEMENT, pas les points de la partie (29/09/2026). Le
        // partage disait « 59 points » quand le classement affiche 308 : les
        // points bruts dépendent de la force du bot, la note les corrige par le
        // nombre de tours (dailyScore.ts). C'est la note qui classe, c'est elle
        // que tout le monde compare. Même fonction et mêmes entrées que le
        // serveur (awards.ts : `dailyNote(score, row.turn_number)`) : le chiffre
        // est exact dès l'écran de fin, sans attendre le réseau.
        score: dailyNote(Math.max(0, match.scores[playerId] ?? 0), match.turnNumber) ?? (match.scores[playerId] ?? 0),
        attempt: Math.max(1, attempts),
      }
      // Le texte à partager ET de quoi fêter la victoire sur l'accueil (score,
      // place du jour) : la carte « Défi réussi ! » les relit.
      const publier = (entree: DailyShareInput) => {
        const texte = dailyShareText(entree)
        saveDailyShare(jour, texte, localStorage, { score: entree.score, rank: entree.rank ?? null })
        setDailyShare(texte)
      }
      publier(partage)
      // Le rang arrive du serveur un instant plus tard. On le demande DÈS
      // l'écran de fin, pas au toucher du bouton : Safari n'ouvre la feuille de
      // partage que dans la foulée immédiate du geste, sans attente réseau.
      if (partage.attempt === 1) {
        void loadDailyLeaderboard(jour).then(classement => {
          if (classement.me && classement.total > 0) publier({ ...partage, rank: { position: classement.me.position, total: classement.total } })
        }).catch(() => undefined)
      }
    } catch {
      // La série est un confort local : si le stockage refuse, le résultat de la
      // partie reste affiché normalement.
      recordedDailyMatches.delete(match.id)
    }
    // Le reste du match est figé une fois la partie terminée : seules ces clés
    // décident de l'enregistrement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match.dailyDate, match.finishReason, match.gridId, match.id, match.isDaily, match.winnerId, playerId])
  const opponentId = match.playerIds.find(id => id !== playerId) ?? ''
  const quetes = useQuestBoard()
  // Le premier panier, offert, devient la récompense de la PREMIÈRE partie (N7) :
  // avant d'avoir joué, un avatar ne voulait encore rien dire.
  const premierePartie = Boolean(experienceAward && experienceAward.levelBefore === 1 && experienceAward.xpAfter - experienceAward.breakdown.total <= 0)
  const actionPrincipale = match.mode === 'ranked' && rejouerClassee
    ? <button type="button" className="new-game is-ranked" disabled={leaving} onClick={() => void leaveResult(rejouerClassee)}><RotateCcw aria-hidden="true" />Rejouer en classée</button>
    : match.isDaily
      ? <button type="button" className="new-game" disabled={leaving} onClick={() => void leaveResult(onExit)}><Gamepad2 aria-hidden="true" />Jouer une partie</button>
      : rejouer && (match.mode === 'normal' || match.mode === 'solo')
        ? <button type="button" className="new-game" disabled={leaving} onClick={() => void leaveResult(() => rejouer(match.pace))}><RotateCcw aria-hidden="true" />Rejouer</button>
        : <button type="button" className="new-game" disabled={leaving} onClick={() => void leaveResult(onExit)}><Gamepad2 aria-hidden="true" />Nouvelle partie</button>
  return <GameResultScreen
    outcome={draw ? 'draw' : won ? 'win' : 'loss'}
    title={title}
    detail={detailDuDefi}
    playerScore={match.scores[playerId] ?? 0}
    opponentScore={match.scores[opponentId] ?? 0}
    opponentName={opponentName}
    award={experienceAward}
    sousAdversaire={<AddOpponentAsFriend playerId={playerId} opponentId={opponentId} opponentName={opponentName} isBot={Boolean(match.bot)} />}
    avantRecompense={match.mode === 'ranked' && match.rankedRating ? <CarteClassee classement={match.rankedRating} /> : null}
  >
    {dailyEffects ? <DailyStreakReward effects={dailyEffects} /> : null}
    {dailyShare ? <DailyShareButton text={dailyShare} /> : null}
    {experienceAward && quetes ? <QuetesDeLaFin quetes={quetes} /> : null}
    {premierePartie ? <p className="result-premier-panier">Ton premier panier est offert : il t’attend à l’Épicerie.</p> : null}
    {experienceAward ? <CarteNotifications /> : null}
    <div className="end-game-actions">
      {revanche
        // Contre un ami, « Rejouer » prend la place de « Nouvelle partie » : deux
        // boutons, pas trois — l'écran de fin déborde déjà à 540 px de haut.
        ? <BoutonsRevanche revanche={revanche} opponentName={opponentName} leaving={leaving} rentrer={() => void leaveResult(onHome)} />
        : <>
          {actionPrincipale}
          <button type="button" className="end-game-home" disabled={leaving} onClick={() => void leaveResult(onHome)}><House />Retour à l’accueil</button>
        </>}
    </div>
    {revanche?.etat.etape === 'sans-reponse' ? <p className="result-feedback-error" role="status">{opponentName} n’a pas accepté la revanche.</p> : null}
    {revanche?.erreur ? <p className="result-feedback-error" role="alert">{revanche.erreur}</p> : null}
    {leavingError ? <p className="result-feedback-error" role="alert">{leavingError}</p> : null}
  </GameResultScreen>
}

// ─────────────────────────────────────────────────────────────────────────────
// LA CARTE CLASSÉE (22/10/2026, code C4 du grand tour).
//
// Elle arrivait en 4e position, sous le bas de l'écran, avec « Classement
// établi · Argent · +22 pt » : ni le total, ni la distance au palier suivant, ni
// le passage d'un palier. Elle passe avant les gains, et dit où l'on en est et
// où l'on va. Une perte s'écrit en gris : sans alarme rouge.
// ─────────────────────────────────────────────────────────────────────────────
function CarteClassee({ classement }: { classement: NonNullable<MatchState['rankedRating']> }) {
  const placements = classement.placementNumber
  const avant = rankedDivision(classement.pointsBefore, Math.max(0, placements - 1))
  const apres = rankedDivision(classement.pointsAfter, placements)
  const suivant = nextRankedDivision(classement.pointsAfter, placements)
  const enPlacement = placements < RANKED_PLACEMENT_MATCHES
  const monte = !enPlacement && avant.id !== 'unranked' && apres.minimum > avant.minimum
  const descend = !enPlacement && avant.id !== 'unranked' && apres.minimum < avant.minimum
  const raison = raisonSansPoints(classement.sansPoints)
  const part = suivant && !enPlacement ? Math.min(1, Math.max(0, (classement.pointsAfter - apres.minimum) / (suivant.minimum - apres.minimum))) : 1
  const delta = classement.delta
  return <section className={`ranked-result-summary ${monte ? 'is-up' : ''}`} aria-label="Ton classement">
    <img src={rankImage(apres)} alt="" />
    <span>
      <small>{enPlacement ? `Placement ${placements} sur ${RANKED_PLACEMENT_MATCHES}` : monte ? 'Nouveau rang' : 'Ton rang'}</small>
      <strong>{enPlacement ? 'Non classé' : `${apres.label} · ${new Intl.NumberFormat('fr-FR').format(classement.pointsAfter)} pt`}</strong>
    </span>
    <b className={delta > 0 ? 'positive' : delta < 0 ? 'negative' : 'neutral'}>{delta > 0 ? '+' : delta < 0 ? '−' : ''}{Math.abs(delta)} pt</b>
    <p className="ranked-result-next">
      {enPlacement
        ? `Encore ${RANKED_PLACEMENT_MATCHES - placements} partie${RANKED_PLACEMENT_MATCHES - placements > 1 ? 's' : ''} pour recevoir ton rang.`
        : monte ? `Tu passes ${apres.label}\u202f!` : descend ? `Tu repasses ${apres.label}.` : suivant ? `Encore ${suivant.minimum - classement.pointsAfter} pt avant ${suivant.label}` : 'Rang maximum'}
    </p>
    {!enPlacement && suivant ? <i className="ranked-result-bar" aria-hidden="true"><b style={{ '--part': part } as CSSProperties} /></i> : null}
    {raison ? <p className="ranked-result-why">{raison}</p> : null}
  </section>
}

/**
 * « On te prévient quand c'est ton tour ? » (N8, 22/10/2026). Dans l'appli
 * Android seulement, tant que le système n'a jamais posé la question : la
 * fenêtre d'Android ne s'ouvre qu'après « Oui » (voir demandeNotifications.ts).
 */
function CarteNotifications() {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    let vivant = true
    void import('../nativePushNotifications')
      .then(module => module.etatDesNotifications())
      .then(etat => { if (vivant && etat && carteDeNotificationsAMontrer(etat, lireReponseCarte())) setVisible(true) })
      .catch(() => undefined)
    return () => { vivant = false }
  }, [])
  if (!visible) return null
  const repondre = (oui: boolean) => {
    noterReponseCarte(oui ? 'oui' : 'plus-tard')
    setVisible(false)
    if (oui) void import('../nativePushNotifications').then(module => module.demanderNotifications()).catch(() => undefined)
  }
  return <div className="result-notifications" role="group" aria-labelledby="result-notifications-titre">
    <BellRing aria-hidden="true" />
    <p><strong id="result-notifications-titre">On te prévient quand c’est ton tour ?</strong><span>Seulement pour tes parties et tes invitations.</span></p>
    <div>
      <button type="button" onClick={() => repondre(true)}>Oui, préviens-moi</button>
      <button type="button" className="secondaire" onClick={() => repondre(false)}>Pas maintenant</button>
    </div>
  </div>
}

// ─────────────────────────────────────────────────────────────────────────────
// LES QUÊTES, À L'INSTANT OÙ L'ON DÉCIDE DE CONTINUER (22/10/2026, code N3).
//
// Elles se font en une ou deux parties, et restaient cachées derrière une icône
// sans texte au moment précis où le joueur pose son téléphone ou relance.
// ─────────────────────────────────────────────────────────────────────────────
function QuetesDeLaFin({ quetes }: { quetes: QuestBoard }) {
  const reussies = [...quetes.day, quetes.week].filter(quete => quete.done && !quete.claimed)
  const prochaine = quetes.day.find(quete => !quete.done)
  if (!reussies.length && !prochaine) return null
  return <div className="result-quetes" role="status">
    {reussies.length ? <p><strong>Quête réussie : {reussies[0].title}</strong>{reussies.length > 1 ? ` (et ${reussies.length - 1} de plus)` : ''} · ta récompense t’attend à l’accueil.</p> : null}
    {prochaine ? <p>Prochaine : {prochaine.title} <span>({prochaine.progress}/{prochaine.target})</span></p> : null}
  </div>
}


function BoutonsRevanche({ revanche, opponentName, leaving, rentrer }: { revanche: Revanche; opponentName: string; leaving: boolean; rentrer: () => void }) {
  const { etat } = revanche
  // En attente : on peut annuler, ou rentrer à l'accueil — l'invitation y
  // reste affichée, et le menu entre dans la partie dès qu'elle est acceptée.
  if (etat.etape === 'attente') return <>
    <button type="button" className="new-game" disabled aria-live="polite"><Hourglass aria-hidden="true" />En attente de {opponentName}…</button>
    <button type="button" className="end-game-home" onClick={revanche.annuler}><X aria-hidden="true" />Annuler l’invitation</button>
  </>
  return <>
    <button type="button" className="new-game" disabled={leaving || etat.etape === 'envoi'} onClick={revanche.proposer}>
      <RotateCcw aria-hidden="true" />{etat.etape === 'envoi' ? 'Invitation…' : `Rejouer contre ${opponentName}`}
    </button>
    <button type="button" className="end-game-home" disabled={leaving} onClick={rentrer}><House aria-hidden="true" />Retour à l’accueil</button>
  </>
}

// ─────────────────────────────────────────────────────────────────────────────
// GARDER L'ADVERSAIRE.
//
// Jusqu'ici, une partie contre un inconnu trouvé par appariement se terminait
// sans aucun moyen de le retrouver : l'ajout d'ami passait uniquement par un
// code à huit caractères, qu'il aurait fallu s'échanger hors du jeu. Chaque
// partie était donc une occasion perdue.
//
// Ce n'est pas du confort. La file classée a déjà gardé un joueur HUIT JOURS
// sans l'apparier : un ami se défie directement, sans attendre personne. C'est
// la seule boucle qui contourne l'appariement, et elle commence ici.
//
// PAS DE REVANCHE À CÔTÉ, et c'est un choix explicite du propriétaire : elle
// transformerait une défaite en dette, et l'envie de « se refaire » est le
// terreau de l'hostilité. On propose de garder quelqu'un, pas de le rattraper.
//
// Le serveur accepte déjà un `targetId` (`social-api`, route `request`) : il
// n'y avait que le bouton à écrire.
// ─────────────────────────────────────────────────────────────────────────────
function AddOpponentAsFriend({ playerId, opponentId, opponentName, isBot }: {
  playerId: string
  opponentId: string
  opponentName: string
  isBot: boolean
}) {
  const [etat, setEtat] = useState<'lecture' | 'repos' | 'envoi' | 'envoye' | 'deja'>('lecture')
  const [erreur, setErreur] = useState<string | null>(null)

  // On demande d'abord où l'on en est avec cet adversaire : proposer d'ajouter
  // quelqu'un qui est déjà un ami (retour du propriétaire, 14/09/2026) donnait
  // l'impression que le jeu avait oublié la relation. Rien ne s'affiche pendant
  // la lecture ; si elle échoue, le bouton reste proposé et le serveur tranche.
  useEffect(() => {
    if (isBot || !opponentId) return
    let vivant = true
    loadSocialState(playerId).then(social => {
      if (!vivant) return
      if (social.friends.some(ami => ami.playerId === opponentId)) setEtat('deja')
      else if (social.outgoing.some(demande => demande.user.playerId === opponentId)) setEtat('envoye')
      else setEtat('repos')
    }, () => { if (vivant) setEtat('repos') })
    return () => { vivant = false }
  }, [isBot, opponentId, playerId])

  // Rien à proposer contre un bot, ni sans adversaire identifié, ni à un ami.
  if (isBot || !opponentId || etat === 'lecture') return null

  const demander = async () => {
    setEtat('envoi')
    setErreur(null)
    try {
      await sendFriendRequestToPlayer(playerId, opponentId)
      setEtat('envoye')
      haptic(10)
    } catch (raison) {
      const message = raison instanceof Error ? raison.message : 'Demande impossible.'
      // Le serveur répond « déjà dans vos amis » : ce n'est pas une erreur à
      // afficher en rouge, c'est une bonne nouvelle mal formulée.
      if (/déjà dans (?:tes|vos) amis/i.test(message)) setEtat('deja')
      else { setEtat('repos'); setErreur(message) }
    }
  }

  if (etat === 'envoye') {
    return <p className="duel-friend-done" role="status"><Check aria-hidden="true" />Demande envoyée</p>
  }
  if (etat === 'deja') return null
  return <div className="duel-friend">
    {/* Une pastille sous le nom de la personne (F2, 22/10/2026) : en grand bouton,
        c'était la première chose à apparaître, et un toucher pressé envoyait une
        demande d'ami à un inconnu. */}
    <button type="button" className="duel-friend-add" aria-label={`Ajouter ${opponentName} en ami`} disabled={etat === 'envoi'} onClick={() => void demander()}>
      <UserPlus aria-hidden="true" />Ajouter en ami
    </button>
    {erreur ? <p className="result-feedback-error" role="alert">{erreur}</p> : null}
  </div>
}

export function PendingResultPanel({
  result,
  playerId,
  acknowledge,
  skip,
}: {
  result: PendingMatchResult
  playerId: string
  acknowledge: (resultId: string) => Promise<void>
  /** Sortie locale, proposée seulement si la validation a échoué (20/09/2026). */
  skip?: () => void
}) {
  const [acknowledging, setAcknowledging] = useState(false)
  const [acknowledgeError, setAcknowledgeError] = useState<string | null>(null)
  const [experienceAward, setExperienceAward] = useState<ExperienceAward | null | undefined>(undefined)
  const won = result.outcome === 'win' || result.outcome === 'opponent-abandoned'
  const draw = result.outcome === 'draw'
  const opponentName = result.opponentName ?? 'Ton adversaire'
  const title = draw ? 'Égalité !' : won ? 'Victoire !' : 'Partie terminée'
  // Même texte que l'écran de fin : sans lui, une bascule vers le classé
  // s'affichait « Vous terminez avec le même score », scores différents ou non.
  const detail = result.finishReason === 'ranked_transfer'
    ? DETAIL_BASCULE_CLASSEE
    : result.finishReason === 'timeout'
    ? absenceDetail(result.pace, won, opponentName)
    : result.finishReason === 'forfeit'
      ? won ? `${opponentName} a quitté la partie.` : 'Tu as abandonné la partie.'
      : draw ? 'Tu termines avec le même score.' : won ? 'Tu as rempli la grille avec le meilleur score.' : `${opponentName} remporte cette grille.`

  useEffect(() => {
    let active = true
    void recompenseDuMatch(result.matchId).then(award => {
      if (active) setExperienceAward(award)
    }).catch(() => { if (active) setExperienceAward(null) })
    haptic(won ? [18, 32, 18, 55, 28] : 24)
    playEffect(won ? 'word' : 'score')
    const reduceMotion = motionReduced()
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' })
    return () => { active = false }
  }, [result.id, result.matchId, won])

  const confirmHome = async () => {
    if (acknowledging) return
    setAcknowledging(true)
    setAcknowledgeError(null)
    try {
      await acknowledge(result.id)
    } catch (reason) {
      setAcknowledgeError(reason instanceof Error ? reason.message : 'Le résultat n’a pas pu être validé.')
      setAcknowledging(false)
    }
  }

  return <GameResultScreen
    outcome={draw ? 'draw' : won ? 'win' : 'loss'}
    title={title}
    detail={detail}
    playerScore={result.score}
    opponentScore={result.opponentScore}
    opponentName={opponentName}
    award={experienceAward}
  >
    <div className="end-game-actions pending-result-actions">
      <button type="button" className="end-game-home" disabled={acknowledging} onClick={() => void confirmHome()}><House />Retour à l’accueil</button>
      {/* SORTIE LOCALE (20/09/2026). Cet écran prend toute l'appli et sa seule
          issue appelait le serveur : si `acknowledge-result` échouait — session
          expirée, 500, ligne déjà soldée —, le joueur relisait son résultat en
          boucle, sans menu, sans réglages, sans « Nous écrire », et relancer
          l'appli le ramenait au même endroit. Ce second bouton ferme l'écran
          sans rien valider ; le résultat reviendra au prochain passage. */}
      {acknowledgeError && skip ? <button type="button" className="end-game-secondary" onClick={skip}>Voir plus tard</button> : null}
    </div>
    {acknowledgeError ? <p className="result-feedback-error" role="alert">{acknowledgeError}</p> : null}
  </GameResultScreen>
}

/**
 * « Quitter la partie ? » — la flèche retour du jeu (et le bouton retour
 * d'Android, qui la presse). En illimité, la flèche ramenait directement à
 * l'accueil ; depuis le 18/09/2026 elle pose la question, comme en temps
 * limité : accueil (la partie attend) ou abandon (demande du propriétaire).
 * Une vraie fenêtre (aria-modal) : le retour d'Android la referme.
 */
export function LeaveMatchPanel({ opponentName, isAsync = false, isDaily = false, cancel, continueLater, leave }: { opponentName: string; isAsync?: boolean; isDaily?: boolean; cancel: () => void; continueLater?: () => void; leave: () => void }) {
  const dialogRef = useDialogFocus<HTMLElement>(cancel)
  const accueil = isAsync && continueLater
  return <div className="mm-modal-layer mm-pause-layer" role="presentation">
    <section ref={dialogRef} className="mm-pause duel-leave" role="dialog" aria-modal="true" aria-labelledby="duel-leave-title" tabIndex={-1}>
      <h2 id="duel-leave-title">{isDaily ? 'Quitter le défi du jour ?' : 'Quitter la partie ?'}</h2>
      {/* Un défi abandonné ne se retente plus avant minuit (19/09/2026) : le
          joueur doit le savoir AVANT de toucher le bouton. */}
      <p>{isDaily
        ? 'Abandonné, il compte pour ta série, mais tu ne pourras plus le retenter avant demain.'
        : isAsync ? 'Elle t’attend à l’accueil — ou abandonne-la, et ton adversaire gagne.' : `${opponentName} remportera la partie par abandon.`}</p>
      {accueil ? <button type="button" data-dialog-autofocus onClick={continueLater}>Retour à l’accueil</button> : null}
      <button type="button" className={accueil ? 'secondary' : undefined} data-dialog-autofocus={accueil ? undefined : true} onClick={cancel}>Continuer à jouer</button>
      <button type="button" className="danger" onClick={leave}>{isDaily ? 'Abandonner le défi' : 'Abandonner la partie'}</button>
    </section>
  </div>
}

