// Le retour d'appui, immédiat — la cause de mollesse la plus visible sur mobile.
//
// ─────────────────────────────────────────────────────────────────────────────
// LE PROBLÈME, ET POURQUOI IL NE SE VOIT QUE SUR TÉLÉPHONE.
//
// Deux choses se cumulent sur Android, et aucune n'est visible à la souris :
//
//   1. `-webkit-tap-highlight-color: transparent` supprime le flash natif que
//      le système dessine sur un élément touché. C'est un choix esthétique
//      légitime — ce flash est gris et laid — mais il enlève le SEUL retour
//      instantané dont disposait le joueur.
//
//   2. Chrome ne pose pas `:active` au premier contact du doigt. Il attend de
//      savoir si le geste est un appui ou le début d'un défilement, parce qu'un
//      bouton dans une zone qui défile peut être touché en passant. Ce délai
//      est court mais parfaitement perceptible.
//
// Résultat : on pose le doigt, et pendant un instant il ne se passe RIEN. C'est
// exactement ce qu'on décrit comme « mécanique » ou « pas fluide », et ça n'a
// rien à voir avec la qualité des animations — c'est un temps mort avant
// qu'elles ne commencent.
//
// LA PARADE : écouter `pointerdown`, qui lui part au premier contact, et poser
// une classe. L'apparence de l'appui ne dépend plus de l'heuristique du
// navigateur.
//
// UN SEUL ÉCOUTEUR, posé sur la racine et délégué : aucun composant à modifier,
// aucun coût par bouton, et les boutons créés plus tard en profitent sans rien
// faire. `passive: true` partout — on ne bloque jamais le défilement.
//
// ⚠️ LE RELÂCHEMENT DOIT ÊTRE À TOUTE ÉPREUVE. Un bouton resté enfoncé parce
// qu'on a manqué un événement est pire que pas de retour du tout. D'où la liste
// large ci-dessous, `pointercancel` compris — c'est lui qui part quand le geste
// se transforme en défilement, le cas le plus fréquent.
// ─────────────────────────────────────────────────────────────────────────────

const CLASSE = 'is-pressed'
const SELECTEUR = 'button, [role="button"], a[href]'

/** Vrai si l'élément ne doit pas réagir : désactivé, ou en cours de traitement. */
function inerte(element: Element): boolean {
  return element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true'
}

export function installPressFeedback(racine: ParentNode & EventTarget = document): () => void {
  let presse: Element | null = null

  const relacher = () => {
    presse?.classList.remove(CLASSE)
    presse = null
  }

  const enfoncer = (evenement: Event) => {
    const cible = (evenement.target as Element | null)?.closest?.(SELECTEUR)
    if (!cible || inerte(cible)) return
    if (presse === cible) return
    relacher()
    presse = cible
    cible.classList.add(CLASSE)
  }

  const options: AddEventListenerOptions = { passive: true, capture: true }
  racine.addEventListener('pointerdown', enfoncer, options)
  // `pointercancel` part quand le geste devient un défilement : sans lui, le
  // bouton resterait enfoncé pendant tout le glissement.
  for (const nom of ['pointerup', 'pointercancel', 'pointerleave', 'dragstart']) {
    racine.addEventListener(nom, relacher, options)
  }
  // Un défilement lancé au doigt ne passe pas toujours par `pointercancel`
  // selon les moteurs ; ce filet le rattrape.
  window.addEventListener('scroll', relacher, { passive: true, capture: true })
  // Et si l'onglet part en arrière-plan, on ne laisse rien d'enfoncé derrière.
  window.addEventListener('blur', relacher)

  return () => {
    relacher()
    racine.removeEventListener('pointerdown', enfoncer, options)
    for (const nom of ['pointerup', 'pointercancel', 'pointerleave', 'dragstart']) {
      racine.removeEventListener(nom, relacher, options)
    }
    window.removeEventListener('scroll', relacher, { capture: true } as EventListenerOptions)
    window.removeEventListener('blur', relacher)
  }
}
