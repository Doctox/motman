// ─────────────────────────────────────────────────────────────────────────────
// LES PREMIERS PASSAGES (15/10/2026)
//
// Le guide de départ est passé de huit étapes à trois (« MotMan au rythme du
// thé », B3) : le reste s'explique la première fois qu'on le croise. Une petite
// carte, en haut de l'Épicerie ou des Quêtes, dit l'essentiel UNE fois, et ne
// revient plus après « Compris ».
//
// Seuls les nouveaux venus les voient : la clé n'existe qu'à partir de la fin
// (ou du saut) du guide court à la première ouverture. Un habitué qui avait lu
// les huit étapes n'a pas cette clé, et ne voit jamais ces cartes ; « Revoir le
// tutoriel », depuis les réglages, ne la crée pas non plus.
// ─────────────────────────────────────────────────────────────────────────────

export const PREMIERS_PASSAGES_CLE = 'motman-premiers-passages'

export type PremierPassage = 'epicerie' | 'quetes'

type Etat = { vus: string[] }

function lire(storage: Pick<Storage, 'getItem'>): Etat | null {
  try {
    const brut = storage.getItem(PREMIERS_PASSAGES_CLE)
    if (!brut) return null
    const etat = JSON.parse(brut) as Partial<Etat> | null
    return etat && Array.isArray(etat.vus) ? { vus: etat.vus.filter(vu => typeof vu === 'string') } : null
  } catch {
    return null
  }
}

/** À la fin du guide de PREMIÈRE ouverture : ce joueur verra les cartes de premier passage. */
export function ouvrirPremiersPassages(storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage): void {
  try {
    if (lire(storage)) return
    storage.setItem(PREMIERS_PASSAGES_CLE, JSON.stringify({ vus: [] } satisfies Etat))
  } catch {
    // Stockage indisponible : pas de carte, le jeu reste jouable.
  }
}

/** La carte de ce lieu est-elle à montrer ? Jamais aux habitués, une fois aux autres. */
export function premierPassageAMontrer(lieu: PremierPassage, storage: Pick<Storage, 'getItem'> = localStorage): boolean {
  const etat = lire(storage)
  return Boolean(etat && !etat.vus.includes(lieu))
}

export function marquerPremierPassageVu(lieu: PremierPassage, storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage): void {
  try {
    const etat = lire(storage)
    if (!etat || etat.vus.includes(lieu)) return
    storage.setItem(PREMIERS_PASSAGES_CLE, JSON.stringify({ vus: [...etat.vus, lieu] } satisfies Etat))
  } catch {
    // Au pire, la carte reviendra une fois de plus.
  }
}
