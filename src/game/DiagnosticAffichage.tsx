import { useEffect, useState } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// LE RELEVÉ D'AFFICHAGE — les yeux qu'on n'a pas dans l'APK.
//
// Le WebView d'une version de production ne s'inspecte pas : aucun pont de
// débogage, contrairement à Chrome. Or les définitions se coupent dans l'app
// alors qu'elles tiennent dans Chrome, sur le MÊME téléphone et le MÊME code.
// Sans mesure, on en est réduit à supposer — et ça a déjà coûté trois
// tentatives le 17/09/2026.
//
// Ce panneau affiche donc, dans l'app, ce que le pont dirait : il suffit d'une
// capture d'écran. Il s'ouvre par TROIS APPUIS sur le chronomètre, un geste que
// personne ne fait par hasard, et rien ne le laisse deviner.
//
// À RETIRER une fois la cause trouvée.
// ─────────────────────────────────────────────────────────────────────────────

function boiteDuTexte(el: Element): DOMRect | null {
  const noeuds = [...el.childNodes].filter(node => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim())
  if (!noeuds.length) return null
  const plage = document.createRange()
  plage.setStartBefore(noeuds[0])
  plage.setEndAfter(noeuds[noeuds.length - 1])
  return plage.getBoundingClientRect()
}

function releve(): string[] {
  const lignes: string[] = []
  lignes.push(`ecran ${window.innerWidth}x${window.innerHeight} dpr ${window.devicePixelRatio}`)
  lignes.push(`natif ${document.documentElement.classList.contains('native-runtime') ? 'oui' : 'non'}`)

  // Le texte d'un canvas échappe à l'agrandissement du système, celui du DOM non.
  try {
    const sonde = document.createElement('span')
    sonde.textContent = 'Definition 123'
    sonde.style.cssText = 'position:absolute;left:-9999px;white-space:pre;font:100px monospace'
    document.body.append(sonde)
    const dom = sonde.getBoundingClientRect().width
    sonde.remove()
    const ctx = document.createElement('canvas').getContext('2d')
    if (ctx) {
      ctx.font = '100px monospace'
      lignes.push(`dom/canvas ${(dom / ctx.measureText('Definition 123').width).toFixed(3)}`)
    }
  } catch { lignes.push('dom/canvas : mesure impossible') }

  // LA QUESTION QUI TRANCHE : notre taille en ligne est-elle AGRANDIE, ou
  // IGNOREE ? On en pose deux, on lit ce que le moteur en fait.
  //  - 10 -> 32 et 20 -> 64 : le WebView agrandit (facteur 3,2).
  //  - 10 -> 16 et 20 -> 16 : la taille posee est ignoree, 16 est le defaut.
  const premiere = document.querySelector('.clue-entry:not(.image-entry)') as HTMLElement | null
  if (premiere) {
    const avant = premiere.style.fontSize
    premiere.style.fontSize = '10px'
    const a = getComputedStyle(premiere).fontSize
    premiere.style.fontSize = '20px'
    const b = getComputedStyle(premiere).fontSize
    premiere.style.setProperty('font-size', '10px', 'important')
    const c = getComputedStyle(premiere).fontSize
    premiere.style.removeProperty('font-size')
    if (avant) premiere.style.fontSize = avant
    const verdict = parseFloat(b) > parseFloat(a) * 1.5 ? 'AGRANDIT' : parseFloat(c) < parseFloat(a) ? 'IGNORE sauf !important' : 'IGNORE'
    lignes.push(`sonde 10->${a} 20->${b} 10!->${c} = ${verdict}`)
  }

  const entrees = [...document.querySelectorAll('.clue-entry:not(.image-entry)')]
  lignes.push(`definitions ${entrees.length}`)
  let deborde = 0
  entrees.forEach(el => {
    const texte = boiteDuTexte(el)
    if (!texte) return
    const boite = el.getBoundingClientRect()
    const style = getComputedStyle(el)
    const dispo = boite.height - (parseFloat(style.paddingTop) || 0) - (parseFloat(style.paddingBottom) || 0)
    if (texte.height > dispo + 0.5) deborde += 1
  })
  lignes.push(`debordent ${deborde}`)

  entrees.slice(0, 3).forEach((el, index) => {
    const texte = boiteDuTexte(el)
    const boite = el.getBoundingClientRect()
    const style = getComputedStyle(el)
    const inline = (el as HTMLElement).style.fontSize || '-'
    lignes.push(`[${index}] calc ${style.fontSize} inline ${inline} poids ${style.fontWeight}`)
    lignes.push(`    case ${Math.round(boite.width)}x${Math.round(boite.height)} marges ${style.paddingTop}/${style.paddingBottom}`)
    lignes.push(`    texte ${texte ? `${Math.round(texte.width)}x${Math.round(texte.height)}` : 'aucun'}`)
  })

  const plateau = document.querySelector('.board') as HTMLElement | null
  lignes.push(`signature ${plateau?.dataset.clueFit?.slice(0, 18) ?? 'aucune'}`)
  return lignes
}

/** Trois appuis sur le chronomètre ouvrent le relevé. */
export function useDiagnosticAffichage(): { ouvert: boolean; compter: () => void; fermer: () => void } {
  const [ouvert, setOuvert] = useState(false)
  const [appuis, setAppuis] = useState<number[]>([])
  useEffect(() => {
    if (appuis.length < 3) return
    setAppuis([])
    setOuvert(true)
  }, [appuis])
  return {
    ouvert,
    compter: () => setAppuis(precedents => [...precedents.filter(instant => Date.now() - instant < 1_500), Date.now()]),
    fermer: () => setOuvert(false),
  }
}

export function DiagnosticAffichage({ fermer }: { fermer: () => void }) {
  const [lignes, setLignes] = useState<string[]>([])
  useEffect(() => { setLignes(releve()) }, [])
  return <div className="diagnostic-affichage" role="dialog" aria-label="Relevé d’affichage">
    <pre>{lignes.join('\n')}</pre>
    <button type="button" onClick={fermer}>Fermer</button>
  </div>
}
