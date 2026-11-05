import { useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight, Lock, Shapes, Sparkles, UserPlus, X } from 'lucide-react'
import { lireRythmeTheme, NOM_ABONNEMENT, PARTIES_OFFERTES_A_UN_AMI, retenirRythmeTheme, type EtatAbonnement, type RythmeTheme, type ThemeAbonnement } from '../abonnement'
import { useDialogFocus } from '../useDialogFocus'
import { nomAffiche, styleDuTheme } from './themeApparence'
import './menu-abonnement.css'

// ─────────────────────────────────────────────────────────────────────────────
// L'ONGLET THÈMES de l'écran Jouer.
//
// Tout le monde voit les vingt thèmes : c'est la vitrine de l'abonnement. Pour
// un abonné, chaque carte ouvre la fiche du thème ; pour les autres, la fiche de
// l'abonnement. Ce sont les grilles du défi du jour, pas un troisième monde de
// grilles réservées (décision du propriétaire, 12/10/2026). Fermées, ces cartes
// annoncent « Bientôt » (05/11/2026). Les nombres de grilles viennent du serveur :
// tant qu'il ne les donne pas, ils ne s'affichent pas.
// ─────────────────────────────────────────────────────────────────────────────

export function ThemesTab({ abonnement, themes, ouvrirOffre, jouerTheme, inviterSurTheme }: {
  abonnement: EtatAbonnement
  themes: readonly ThemeAbonnement[]
  ouvrirOffre: () => void
  jouerTheme: (theme: ThemeAbonnement, rythme: RythmeTheme) => void
  inviterSurTheme: (theme: ThemeAbonnement) => void
}) {
  const [ouvert, setOuvert] = useState<ThemeAbonnement | null>(null)
  const grilles = themes.reduce((total, theme) => total + theme.grilles, 0)
  return <>
    <section className="mm-play-card is-plus">
      <header>
        <span className="mm-play-card-icon" aria-hidden="true"><Shapes /></span>
        <span><h2>Grilles à thème</h2><small>{themes.length} thèmes · {abonnement.actif && grilles > 0 ? `${grilles} grilles · ` : ''}à ton niveau, quand tu veux</small></span>
      </header>
      {abonnement.actif ? null : <>
        <button type="button" className="mm-play-cta is-plus" onClick={ouvrirOffre}><Sparkles />Découvrir {NOM_ABONNEMENT}<ChevronRight /></button>
        <p className="mm-plus-hint">Bientôt dans MotMan</p>
      </>}
    </section>

    <ul className="mm-theme-grid" aria-label="Les thèmes">
      {themes.map(theme => {
        const restantes = theme.grilles - theme.jouees
        return <li key={theme.nom}>
          <button
            type="button"
            className={`mm-theme-card ${abonnement.actif ? '' : 'is-locked'}`}
            style={styleDuTheme(theme.nom)}
            aria-label={abonnement.actif ? theme.grilles > 0 ? `${nomAffiche(theme.nom)}, ${theme.jouees} grilles jouées sur ${theme.grilles}` : nomAffiche(theme.nom) : `${nomAffiche(theme.nom)}, bientôt avec ${NOM_ABONNEMENT}`}
            onClick={() => abonnement.actif ? setOuvert(theme) : ouvrirOffre()}
          >
            <span className="mm-theme-card-icon" aria-hidden="true"><i /></span>
            {abonnement.actif
              ? theme.grilles > 0 && theme.jouees === 0 ? <span className="mm-theme-card-new" aria-hidden="true">À essayer</span> : null
              : <span className="mm-theme-card-lock" aria-hidden="true"><Lock /></span>}
            <strong>{nomAffiche(theme.nom)}</strong>
            <span className="mm-theme-card-foot">
              {abonnement.actif ? theme.grilles > 0 ? <>
                <span className="mm-theme-card-bar" aria-hidden="true"><i style={{ width: `${Math.min(100, theme.jouees / Math.max(1, theme.grilles) * 100)}%` }} /></span>
                <small>{restantes > 0 ? `${restantes} à découvrir` : 'Toutes jouées'}</small>
              </> : null : <small>Bientôt</small>}
            </span>
          </button>
        </li>
      })}
    </ul>

    {ouvert ? <ThemeSheet theme={ouvert} close={() => setOuvert(null)} jouer={rythme => { setOuvert(null); jouerTheme(ouvert, rythme) }} inviter={() => { setOuvert(null); inviterSurTheme(ouvert) }} /> : null}
  </>
}

function ThemeSheet({ theme, close, jouer, inviter }: { theme: ThemeAbonnement; close: () => void; jouer: (rythme: RythmeTheme) => void; inviter: () => void }) {
  const dialogRef = useDialogFocus<HTMLElement>(close)
  const [rythme, setRythme] = useState<RythmeTheme>(lireRythmeTheme)
  const choisir = (suivant: RythmeTheme) => { setRythme(suivant); retenirRythmeTheme(suivant) }
  const restantes = theme.grilles - theme.jouees
  // Hors de la page : elle est animée, et un calque « fixe » posé dedans s'y
  // retrouve enfermé, au-dessus de la barre du bas au lieu de la couvrir.
  return createPortal(<div className="mm-modal-layer" role="presentation" onMouseDown={event => event.target === event.currentTarget && close()}>
    <section ref={dialogRef} className="mm-theme-sheet" style={styleDuTheme(theme.nom)} role="dialog" aria-modal="true" aria-label={nomAffiche(theme.nom)} tabIndex={-1}>
      <header>
        <span className="mm-theme-card-icon" aria-hidden="true"><i /></span>
        <span><small>Grilles à thème</small><h2>{nomAffiche(theme.nom)}</h2></span>
        <button type="button" onClick={close} aria-label="Fermer"><X /></button>
      </header>
      {theme.grilles > 0 ? <><dl className="mm-theme-sheet-stats">
        <div><dt>Grilles</dt><dd>{theme.grilles}</dd></div>
        <div><dt>Jouées</dt><dd>{theme.jouees}</dd></div>
        <div><dt>À découvrir</dt><dd>{Math.max(0, restantes)}</dd></div>
      </dl>
      <p className="mm-theme-sheet-note">{restantes > 0
        ? 'Tu tombes d’abord sur une grille que tu n’as jamais jouée.'
        : 'Tu les as toutes jouées : on repart de celles que tu as le moins revues. De nouvelles grilles arrivent au fil des semaines.'}</p></> : null}
      <div className="mm-pace-choice" role="group" aria-label="Choisir le rythme de la partie">
        <button type="button" className={rythme === 'chrono' ? 'active' : ''} aria-pressed={rythme === 'chrono'} aria-label="Avec chrono, 45 secondes par tour" onClick={() => choisir('chrono')}>
          <strong>Avec chrono</strong><small>45 s par tour</small>
        </button>
        <button type="button" className={rythme === 'calme' ? 'active' : ''} aria-pressed={rythme === 'calme'} aria-label="Au calme, sans chrono" onClick={() => choisir('calme')}>
          <strong>Au calme</strong><small>Sans chrono</small>
        </button>
      </div>
      <p className="mm-theme-sheet-rythme">{rythme === 'calme' ? 'Seul, sans chrono ni récompense : juste pour le plaisir.' : 'XP et plumes, comme une partie normale.'}</p>
      <button type="button" className="mm-play-cta" onClick={() => jouer(rythme)}>Jouer ce thème <ChevronRight /></button>
      <button type="button" className="mm-theme-sheet-friend" onClick={inviter}>
        <span aria-hidden="true"><UserPlus /></span>
        <span><strong>Inviter un ami sur ce thème</strong><small>Même sans abonnement : {PARTIES_OFFERTES_A_UN_AMI} parties à thème offertes</small></span>
        <ChevronRight />
      </button>
    </section>
  </div>, document.querySelector('.mm-shell') ?? document.body)
}
