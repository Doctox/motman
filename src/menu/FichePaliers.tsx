import { X } from 'lucide-react'
import { RANKED_DIVISIONS, rankImage, rankedDivision, RANKED_PLACEMENT_MATCHES } from '../ranked'
import { useDialogFocus } from '../useDialogFocus'
import { portailDuMenu } from './portailDuMenu'
import './menu-paliers.css'

// ─────────────────────────────────────────────────────────────────────────────
// « LES PALIERS » (22/10/2026, code C5 du grand tour).
//
// Rien n'expliquait les paliers : combien il y en a, à quel seuil, ni ce que
// rapporte une victoire. On touche l'insigne de son rang, et l'échelle s'ouvre,
// son propre palier surligné.
//
// La phrase sur la victoire suit la règle du serveur (K = 40 une fois les
// placements faits, `server_apply_ranked_result_atomic`) : contre un joueur de
// même niveau, une victoire vaut 40 × 0,5 = 20 points. Si la règle change, la
// phrase doit changer avec elle.
// ─────────────────────────────────────────────────────────────────────────────

const nombre = new Intl.NumberFormat('fr-FR')

export function FichePaliers({ points, matches, close }: { points: number; matches: number; close: () => void }) {
  const dialogRef = useDialogFocus<HTMLDivElement>(close)
  const actuel = rankedDivision(points, matches)
  // Hors de la page qui l'ouvre, dans la coquille du menu (portailDuMenu.ts) :
  // en 320 × 616, la page cachait son titre et sa croix.
  return portailDuMenu(<div className="mm-modal-layer mm-paliers-layer" role="presentation" onMouseDown={event => event.target === event.currentTarget && close()}>
    <div ref={dialogRef} className="mm-paliers" role="dialog" aria-modal="true" aria-labelledby="mm-paliers-titre" tabIndex={-1}>
      <header>
        <h2 id="mm-paliers-titre">Les paliers</h2>
        <button type="button" className="mm-paliers-fermer" aria-label="Fermer" onClick={close}><X aria-hidden="true" /></button>
      </header>
      <ol className="mm-paliers-liste">
        {[...RANKED_DIVISIONS].reverse().map(palier => <li key={palier.id} className={palier.id === actuel.id ? 'is-mine' : ''} aria-current={palier.id === actuel.id ? 'true' : undefined}>
          <img src={rankImage(palier)} alt="" />
          <strong>{palier.label}</strong>
          <span>{palier.minimum === 0 ? 'dès le départ' : `dès ${nombre.format(palier.minimum)} pt`}</span>
        </li>)}
      </ol>
      <p>Une victoire contre un joueur de ton niveau rapporte une vingtaine de points ; une défaite en coûte autant. Battre plus fort que toi rapporte davantage.</p>
      {matches < RANKED_PLACEMENT_MATCHES ? <p className="mm-paliers-note">Ton palier apparaît après tes {RANKED_PLACEMENT_MATCHES} parties de placement.</p> : null}
    </div>
  </div>)
}
