import './menu-silhouettes.css'

// ─────────────────────────────────────────────────────────────────────────────
// LES SILHOUETTES DE CHARGEMENT (15/10/2026, « MotMan au toucher », G5)
//
// À la place d'un texte gris (« Chargement du classement… ») qui laissait tout
// apparaître d'un bloc : la forme de ce qui arrive est déjà là, avec un léger
// reflet, et le contenu s'y pose. Le texte reste pour les lecteurs d'écran.
// ─────────────────────────────────────────────────────────────────────────────

/** Des lignes de classement : rang, portrait, nom, points. */
export function SilhouettesDeRangs({ libelle, nombre = 7 }: { libelle: string; nombre?: number }) {
  return <div className="mm-silhouettes" role="status" aria-label={libelle}>
    {Array.from({ length: nombre }, (_, index) => <div key={index} className="mm-silhouette-rang" aria-hidden="true">
      <i className="mm-silhouette-pos" /><i className="mm-silhouette-rond" />
      <span><i style={{ width: `${72 - (index % 3) * 14}%` }} /><i style={{ width: '38%' }} /></span>
      <i className="mm-silhouette-valeur" />
    </div>)}
  </div>
}

/** Des quêtes : pictogramme, intitulé, barre de progression. */
export function SilhouettesDeQuetes({ nombre = 3 }: { nombre?: number }) {
  return <div className="mm-silhouettes mm-silhouettes-quetes" role="status" aria-label="Tes quêtes arrivent">
    {Array.from({ length: nombre }, (_, index) => <div key={index} className="mm-silhouette-quete" aria-hidden="true">
      <i className="mm-silhouette-carre" />
      <span><i style={{ width: `${68 - index * 10}%` }} /><i style={{ width: '44%' }} /><i className="mm-silhouette-barre" /></span>
    </div>)}
  </div>
}

/** L'Épicerie pendant que son code arrive : la barre, les rayons, un panier. */
export function SilhouetteEpicerie() {
  return <div className="mm-silhouettes mm-silhouette-epicerie" aria-hidden="true">
    <div className="mm-silhouette-ligne"><i className="mm-silhouette-rond" /><i style={{ flex: 1 }} /><i style={{ width: 74 }} /></div>
    <i className="mm-silhouette-rayons" />
    <i className="mm-silhouette-carte" />
  </div>
}
