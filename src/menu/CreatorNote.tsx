import { HeartHandshake } from 'lucide-react'
import { INSTAGRAM_STUDIO, TIKTOK_STUDIO } from '../creatorNote'
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
 */
export function CreatorNote({ close }: { close: () => void }) {
  const dialogRef = useDialogFocus<HTMLDivElement>(close)
  return (
    <div className="mm-modal-layer mm-createur-layer" role="presentation" onMouseDown={event => event.target === event.currentTarget && close()}>
      <div ref={dialogRef} className="mm-createur" role="dialog" aria-modal="true" aria-labelledby="createur-titre" tabIndex={-1}>
        <h2 id="createur-titre"><HeartHandshake aria-hidden="true" />Un mot du créateur</h2>
        <p>Salut ! Je développe MotMan tout seul, et je paie le jeu et ses serveurs de ma poche.</p>
        <p>Pour qu’il continue de grandir, il a besoin d’être connu. Un abonnement aux comptes du Studio Doctox m’aide énormément :</p>
        <div className="mm-createur-liens">
          <a className="is-instagram" href={INSTAGRAM_STUDIO} target="_blank" rel="noreferrer"><LogoInstagram /><span>Instagram<small>@studiodoctox</small></span></a>
          <a className="is-tiktok" href={TIKTOK_STUDIO} target="_blank" rel="noreferrer"><LogoTikTok /><span>TikTok<small>@studiodoctox</small></span></a>
        </div>
        <p className="mm-createur-signature">Merci, et bonne partie ! — DocTox</p>
        <button type="button" className="mm-createur-fermer" data-dialog-autofocus onClick={close}>Jouer</button>
      </div>
    </div>
  )
}
