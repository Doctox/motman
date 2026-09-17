import { useEffect, useState } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// LE CHRONO D'UNE RECHERCHE D'ADVERSAIRE
//
// Il COMPTE, il ne décompte pas : 1 s, 2 s, 3 s… Ce n'est pas un temps restant.
// Rien ne permettrait d'ailleurs d'en promettre un — le serveur bascule sur un
// bot au bout de quinze secondes en normal, et la file classée cherche jusqu'à
// dix minutes.
//
// Le calcul vivait dans `NormalSearchPanel` (MatchActivityPanels.tsx), qui
// affichait déjà les secondes écoulées. Les cartes de l'écran Jouer, elles,
// n'avaient que trois points qui clignotent. Le raisonnement de ce panneau vaut
// pour elles : la question du joueur n'est pas « combien de temps encore » mais
// « est-ce que c'est bloqué ». Un compteur qui avance y répond, une animation
// non.
//
// Le calcul est donc partagé, pas recopié : deux horloges qui dérivent sur le
// même écran seraient pires que pas d'horloge du tout.
// ─────────────────────────────────────────────────────────────────────────────

/** Secondes écoulées depuis une date ISO, remises à jour chaque seconde. */
export function useSecondesEcoulees(since: string | null | undefined): number | null {
  const [maintenant, setMaintenant] = useState(() => Date.now())
  useEffect(() => {
    if (!since) return
    const battement = setInterval(() => setMaintenant(Date.now()), 1000)
    return () => clearInterval(battement)
  }, [since])
  const depuis = since ? Date.parse(since) : Number.NaN
  return Number.isFinite(depuis) ? Math.max(0, Math.floor((maintenant - depuis) / 1000)) : null
}

/**
 * Les secondes telles quelles sous la minute — `1 s`, `2 s`, `3 s` — puis
 * `m:ss`. La recherche normale ne dépasse jamais quinze secondes et se lit donc
 * toujours en secondes ; seule la file classée, qui court jusqu'à dix minutes,
 * atteint la forme longue, où « 437 s » ne voudrait plus rien dire.
 */
export function chronoRecherche(secondes: number): string {
  const sures = Math.max(0, Math.floor(secondes))
  if (sures < 60) return `${sures} s`
  return `${Math.floor(sures / 60)}:${String(sures % 60).padStart(2, '0')}`
}

/**
 * Le chrono affiché. Masqué aux lecteurs d'écran : il vit dans une région
 * `aria-live="polite"`, et un texte qui change chaque seconde y ferait répéter
 * la carte entière en boucle. Le titre de la recherche, lui, reste annoncé.
 *
 * Sans date de départ — un état de transition du classé, par exemple — rien ne
 * s'affiche plutôt qu'un `0 s` figé qui ferait croire à un blocage.
 */
export function ChronoRecherche({ depuis }: { depuis: string | null | undefined }) {
  const secondes = useSecondesEcoulees(depuis)
  if (secondes === null) return null
  return <span className="mm-search-timer" aria-hidden="true">{chronoRecherche(secondes)}</span>
}
