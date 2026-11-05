import { assetUrl } from '../assetUrl'
import './menu-abonnement.css'

// ─────────────────────────────────────────────────────────────────────────────
// LE LOGO MOTMAN+ — le logo MotMan tel quel, un « + » doré dans sa grille.
//
// Choix du propriétaire (16/10/2026) : ne pas toucher aux couleurs du logo, la
// case terre cuite reste ; le « + » se pose dans la case vide d'en haut à
// droite du O. Il est dessiné par-dessus l'image du logo, pas peint dedans :
// net à toutes les tailles. La nuit montre le vrai logo de nuit, comme l'en-tête :
// le filtre posé sur le logo de jour le rendait sarcelle (05/11/2026).
//
// Position mesurée sur motman-logo-v2 (2472 × 536, PNG et WebP identiques) :
// case vide x 731–865, y 112–246, centre (798, 179). Le « + » fait 104 px de
// côté (77 % de la case) et 30 d'épaisseur : à 55 %, il ne faisait plus que
// 6 px dans la fiche et ne se voyait pas.
// ─────────────────────────────────────────────────────────────────────────────

export function LogoMotManPlus({ className = '' }: { className?: string }) {
  return <span className={`mm-logo-plus ${className}`} role="img" aria-label="MotMan+">
    <img className="mm-logo-plus-jour" src={assetUrl('/assets/motman-logo-v2.webp')} alt="" />
    <img className="mm-logo-plus-nuit" src={assetUrl('/assets/motman-logo-v2-dark.webp')} alt="" />
    <svg className="mm-logo-plus-croix" viewBox="0 0 104 104" aria-hidden="true">
      <rect x="37" y="0" width="30" height="104" rx="6" />
      <rect x="0" y="37" width="104" height="30" rx="6" />
    </svg>
  </span>
}

/** Le O du logo seul, avec son « + » : l'icône de l'abonnement (profil, fiche). */
export function IconeMotManPlus({ taille = 44 }: { taille?: number }) {
  return <svg className="mm-icone-plus" width={taille} height={taille} viewBox="0 0 64 64" aria-hidden="true">
    <path className="mm-icone-plus-case" d="M34.9 34.9H58.3V48.3A10 10 0 0 1 48.3 58.3H34.9Z" />
    <rect x="2.9" y="2.9" width="58.2" height="58.2" rx="13.5" fill="none" stroke="currentColor" strokeWidth="5.8" />
    <path d="M32 2.9V61.1M2.9 32H61.1" stroke="currentColor" strokeWidth="5.8" />
    <path className="mm-icone-plus-croix" d="M46.6 11V23.8M40.2 17.4H53" strokeWidth="5" strokeLinecap="round" />
  </svg>
}
