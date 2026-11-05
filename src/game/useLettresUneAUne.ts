import { useEffect, useMemo, useRef, useState } from 'react'
import { attenteAvantLaLettre, casesAMontrer, lettresDejaMontrees, type EnDirect } from './lettresEnDirect'

const AUCUNE: ReadonlySet<number> = new Set()

/** Les lettres de l'autre, l'une après l'autre (lettresEnDirect.ts). Un nouveau tour repart de zéro. */
export function useLettresUneAUne(enDirect: EnDirect | null, lettres: Readonly<Record<number, string>>): Readonly<Record<number, string>> {
  const [vues, setVues] = useState<{ tour: number | null; cases: ReadonlySet<number> }>({ tour: null, cases: AUCUNE })
  const precedenteA = useRef(0)
  const tour = enDirect?.turnNumber ?? null
  const montrees = vues.tour === tour ? vues.cases : AUCUNE
  const aMontrer = casesAMontrer(enDirect, lettres, montrees)
  const suivante = aMontrer[0]
  const restantes = aMontrer.length

  // Un sondage sans rien de neuf ne relance pas le minuteur : l'effet ne suit que ces trois valeurs.
  useEffect(() => {
    if (suivante === undefined) return
    const minuteur = window.setTimeout(() => {
      precedenteA.current = Date.now()
      setVues(avant => ({ tour, cases: new Set([...(avant.tour === tour ? avant.cases : []), suivante]) }))
    }, attenteAvantLaLettre(restantes, Date.now() - precedenteA.current))
    return () => window.clearTimeout(minuteur)
  }, [tour, suivante, restantes])

  return useMemo(() => lettresDejaMontrees(lettres, montrees), [lettres, montrees])
}
