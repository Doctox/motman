// ─────────────────────────────────────────────────────────────────────────────
// LE CLAVIER NE CACHE PLUS RIEN (15/10/2026, « MotMan au toucher », H15)
//
// Sur iPhone, et dans Chrome sur le site, le clavier se pose PAR-DESSUS la page
// au lieu de la raccourcir : le bas d'une fenêtre (« Enregistrer » dans
// l'éditeur de profil) passait dessous. `--mm-clavier` donne la hauteur qu'il
// recouvre ; les fenêtres du bas s'en servent pour remonter au-dessus.
// L'appli Android se redimensionne déjà toute seule : la valeur y reste à 0.
// ─────────────────────────────────────────────────────────────────────────────

/** La hauteur cachée par le clavier, d'après la fenêtre visible. */
export function hauteurDuClavier(hauteurFenetre: number, visible: { height: number; offsetTop: number }): number {
  return Math.max(0, Math.round(hauteurFenetre - visible.height - visible.offsetTop))
}

export function installerClavierVisible(fenetre: Window = window): void {
  const visible = fenetre.visualViewport
  if (!visible) return
  const racine = fenetre.document.documentElement
  const lire = () => racine.style.setProperty('--mm-clavier', `${hauteurDuClavier(fenetre.innerHeight, visible)}px`)
  lire()
  visible.addEventListener('resize', lire)
  visible.addEventListener('scroll', lire)
}
