import type { CSSProperties } from 'react'
import type { ExperienceAward, ExperienceOutcome } from './playerProgress'
import { MAX_PLAYER_LEVEL } from './playerProgress'
import { Feather, Flame, Sparkles } from 'lucide-react'

// ─────────────────────────────────────────────────────────────────────────────
// CE QUE TU REPARS AVEC (refait le 22/10/2026, codes F1 et F5 du grand tour).
//
// Le cadre alignait neuf nombres : deux lignes « Résultat » pour deux monnaies,
// l'XP en terracotta (la couleur de l'adversaire), des étiquettes de 8 px, et
// une barre qui repartait de zéro au lieu de montrer ce qui venait d'être
// gagné. « Comprend-on en deux secondes ce qu'on a gagné ? » : non.
//
// Désormais : une phrase et deux pastilles égales ; la barre où seul le GAIN
// grandit ; le détail plié derrière « Voir le détail », rangé par monnaie, dans
// les mots du jeu (« Sans relance des lettres », comme le bouton « Relancer »).
// Un niveau gagné s'annonce en grand : c'est un jalon, pas une note de bas de
// cadre.
// ─────────────────────────────────────────────────────────────────────────────

/** Le mot du résultat, selon l'issue de la partie : « Résultat » ne disait rien. */
export function motDuResultat(outcome: ExperienceOutcome): string {
  if (outcome === 'win') return 'Victoire'
  if (outcome === 'draw') return 'Égalité'
  if (outcome === 'opponent-abandoned') return 'Victoire par abandon'
  return 'Partie jouée'
}

/** Où commence le gain sur la barre du niveau atteint : de zéro s'il vient d'être franchi. */
export function departDuGain(award: Pick<ExperienceAward, 'levelBefore' | 'levelAfter' | 'xpAfter' | 'breakdown'>): number {
  if (award.levelAfter > award.levelBefore) return 0
  return Math.max(0, award.xpAfter - award.breakdown.total)
}

export function ExperienceReward({ award }: { award: ExperienceAward }) {
  const reachedMax = award.levelAfter >= MAX_PLAYER_LEVEL
  const levelUp = award.levelAfter > award.levelBefore
  // Le bonus du défi du jour est versé hors `experience_awards` : il est remonté
  // séparément par le serveur et n'est renseigné QUE s'il a réellement été
  // crédité pour ce match (rejeu gagnant du même jour → 0, donc rien d'affiché).
  const dailyBonus = award.dailyBonusPlumes ?? 0
  const plumesTotal = (award.plumesEarned ?? 0) + dailyBonus
  // Une absence sans un seul tour joué enregistre une récompense vide : un cadre
  // « +0 XP · 0 tour » n'apprend rien (F4).
  if (award.breakdown.total <= 0 && plumesTotal <= 0) return null
  const goal = Math.max(1, award.xpGoalAfter)
  const avant = reachedMax ? 1 : Math.min(1, departDuGain(award) / goal)
  const apres = reachedMax ? 1 : Math.min(1, award.xpAfter / goal)
  const resultat = motDuResultat(award.outcome)
  const featherDetails = [
    [resultat, award.featherBreakdown?.base],
    ['Sans indice', award.featherBreakdown?.noHint],
    ['Sans relance des lettres', award.featherBreakdown?.noReroll],
    ['Chevalet complet', award.featherBreakdown?.fullRack],
  ].filter((entry): entry is [string, number] => typeof entry[1] === 'number' && entry[1] > 0)
  const xpDetails = [
    [`${award.breakdown.productiveTurns} tour${award.breakdown.productiveTurns > 1 ? 's' : ''} où tu as marqué`, award.breakdown.productiveXp],
    ['Grille terminée', award.breakdown.completionXp],
    [resultat, award.breakdown.resultXp],
  ].filter((entry): entry is [string, number] => typeof entry[1] === 'number' && entry[1] > 0)
  const resteAvantNiveau = Math.max(0, award.xpGoalAfter - award.xpAfter)
  return <section className="experience-reward" aria-label={`Tu repars avec ${award.breakdown.total} points d’expérience${plumesTotal ? ` et ${plumesTotal} plumes` : ''}`}>
    <div className="experience-reward-heading">
      <span>Tu repars avec</span>
      <div className="experience-gains">
        <strong className="experience-gain-xp">+{award.breakdown.total}&nbsp;XP</strong>
        {plumesTotal ? <strong className="experience-gain-plumes"><Feather aria-hidden="true" />+{plumesTotal}&nbsp;plumes</strong> : null}
      </div>
    </div>
    {dailyBonus ? <div className="experience-daily-bonus" aria-label={`Bonus du défi du jour : ${dailyBonus} plumes`}><Flame aria-hidden="true" /><span>Défi du jour réussi</span><b>+{dailyBonus} plumes</b></div> : null}
    {levelUp && !reachedMax ? <p className="experience-level-up">Niveau {award.levelAfter} atteint&nbsp;!</p> : null}
    <div className="experience-level">
      <span>{reachedMax ? 'Niveau maximum' : `Niveau ${award.levelAfter}`}</span>
      {reachedMax ? <strong>50</strong> : <small>{resteAvantNiveau > 0 ? `Encore ${resteAvantNiveau} XP avant le niveau ${award.levelAfter + 1}` : `${award.xpAfter} / ${award.xpGoalAfter}`}</small>}
    </div>
    <i className="experience-progress" style={{ '--avant': avant, '--apres': apres } as CSSProperties}><b className="experience-progress-avant" /><b className="experience-progress-gain" /></i>
    {featherDetails.length || xpDetails.length ? <details className="experience-details">
      <summary>Voir le détail</summary>
      {xpDetails.length ? <div className="experience-breakdown"><h3>Expérience</h3>{xpDetails.map(([label, amount]) => <span key={label}>{label}<b>+{amount}</b></span>)}</div> : null}
      {featherDetails.length ? <div className="experience-breakdown experience-feather-breakdown"><h3>Plumes</h3>{featherDetails.map(([label, amount]) => <span key={label}>{label}<b>+{amount}</b></span>)}</div> : null}
    </details> : null}
    {award.unlockedTitles?.map(title => <div className="experience-title-unlocked" key={title.id}><Sparkles /><span><small>Nouveau titre</small><strong>{title.name}</strong></span></div>)}
  </section>
}
