import { useState } from 'react'
import { HeartHandshake, Sparkles } from 'lucide-react'
import { INSTAGRAM_STUDIO, TIKTOK_STUDIO } from '../creatorNote'
import { marquerNouveauteLue, nouveautesDesDernieres24h, useNouveautes, type Nouveaute } from '../nouveautes'
import { RapportsDeNouveautes } from './Nouveautes'
import { useDialogFocus } from '../useDialogFocus'
import './menu-createur.css'

// Le glyphe Instagram : carré arrondi, objectif, voyant. Tracé au trait comme
// les icônes lucide de l'application (lucide ne fournit plus les marques).
function LogoInstagram() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="20" rx="5.5" />
      <circle cx="12" cy="12" r="4.2" />
      <circle cx="17.6" cy="6.4" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  )
}

// La note de TikTok, en aplat.
function LogoTikTok() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" />
    </svg>
  )
}

/**
 * Le mot du créateur, à la première ouverture de la journée (11/10/2026).
 * Les deux liens sont de simples liens web : sur Android, le système les
 * confie à l'application Instagram ou TikTok si elle est installée, comme il
 * confie déjà au Play Store le lien de mise à jour.
 *
 * L'ONGLET « NOUVEAUTÉS » (12/10/2026). S'il est paru une nouveauté dans les
 * dernières 24 heures, un second onglet la montre ; sinon il n'existe pas. Le
 * mot du créateur reste l'onglet d'ouverture ; ouvrir les nouveautés les
 * marque lues, comme dans le menu — la pastille de la roue s'éteint.
 */
export function CreatorNote({ close, recentes: recentesImposees }: { close: () => void; recentes?: readonly Nouveaute[] }) {
  const dialogRef = useDialogFocus<HTMLDivElement>(close)
  const { publiees } = useNouveautes()
  const recentes = recentesImposees ?? nouveautesDesDernieres24h(publiees)
  const [onglet, setOnglet] = useState<'mot' | 'nouveautes'>('mot')
  const nombre = recentes.reduce((total, message) => total + message.rapports.length, 0)
  const ouvrirNouveautes = () => {
    setOnglet('nouveautes')
    for (const message of recentes) marquerNouveauteLue(message.id)
  }
  return (
    <div className="mm-modal-layer mm-createur-layer" role="presentation" onMouseDown={event => event.target === event.currentTarget && close()}>
      <div ref={dialogRef} className="mm-createur" role="dialog" aria-modal="true" aria-label="Un mot du créateur" tabIndex={-1}>
        {recentes.length ? (
          <div className="mm-createur-onglets" role="tablist" aria-label="Contenu">
            <button type="button" role="tab" aria-selected={onglet === 'mot'} className={onglet === 'mot' ? 'is-active' : ''} onClick={() => setOnglet('mot')}>
              <HeartHandshake aria-hidden="true" />Le mot du créateur
            </button>
            <button type="button" role="tab" aria-selected={onglet === 'nouveautes'} className={onglet === 'nouveautes' ? 'is-active' : ''} onClick={ouvrirNouveautes}>
              <Sparkles aria-hidden="true" />Nouveautés<b aria-label={`${nombre} nouveauté${nombre > 1 ? 's' : ''}`}>{nombre}</b>
            </button>
          </div>
        ) : null}

        {onglet === 'mot' ? (
          <div role={recentes.length ? 'tabpanel' : undefined}>
            <h2><HeartHandshake aria-hidden="true" />Un mot du créateur</h2>
            <p>Salut ! Je développe MotMan tout seul, et je paie le jeu et ses serveurs de ma poche.</p>
            <p>Pour qu’il continue de grandir, il a besoin d’être connu. Un abonnement aux comptes du Studio Doctox m’aide énormément :</p>
            <div className="mm-createur-liens">
              <a className="is-instagram" href={INSTAGRAM_STUDIO} target="_blank" rel="noreferrer"><LogoInstagram /><span>Instagram<small>@studiodoctox</small></span></a>
              <a className="is-tiktok" href={TIKTOK_STUDIO} target="_blank" rel="noreferrer"><LogoTikTok /><span>TikTok<small>@studiodoctox</small></span></a>
            </div>
            <p className="mm-createur-signature">Merci, et bonne partie ! — DocTox</p>
          </div>
        ) : (
          <div role="tabpanel" className="mm-createur-nouveautes">
            <h2><Sparkles aria-hidden="true" />Les dernières nouveautés</h2>
            <RapportsDeNouveautes messages={recentes} />
          </div>
        )}
        <button type="button" className="mm-createur-fermer" data-dialog-autofocus onClick={close}>Jouer</button>
      </div>
    </div>
  )
}
