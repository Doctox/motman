import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { serverNow } from '../serverClock'
import { etapeDuGuide, type BulleLue, type VueDuGuide } from './etapesDuCoach'
import { laisserJouerMotMan, relancerLeChrono } from './moteurGuide'
import './partie-guidee.css'

// LE GUIDE DE LA PARTIE GUIDÉE (11/11/2026), posé sur le vrai écran de jeu.
// Un voile sombre, percé de fenêtres sur ce qu'il faut toucher : le voile arrête
// les touchers, les fenêtres les laissent passer (la découpe est un tracé SVG
// « evenodd », dont les trous ne captent rien). La bulle se met dans le plus
// grand espace libre, au-dessus ou au-dessous des fenêtres.

type Rect = { x: number; y: number; l: number; h: number }

const MARGE = 4

function mesurer(selecteurs: string[]): Rect[] {
  const rects = selecteurs.flatMap(selecteur => [...document.querySelectorAll<HTMLElement>(selecteur)])
    .map(element => element.getBoundingClientRect())
    .filter(boite => boite.width > 0 && boite.height > 0)
    .map(boite => ({ x: boite.left - MARGE, y: boite.top - MARGE, l: boite.width + MARGE * 2, h: boite.height + MARGE * 2 }))
  // Une fenêtre déjà contenue dans une autre la rebucherait (règle evenodd) : on l'écarte.
  return rects.filter((rect, rang) => !rects.some((autre, autreRang) => autreRang !== rang
    && autre.x <= rect.x && autre.y <= rect.y && autre.x + autre.l >= rect.x + rect.l && autre.y + autre.h >= rect.y + rect.h
    && (autre.l * autre.h > rect.l * rect.h || autreRang < rang)))
}

const memesRects = (a: Rect[], b: Rect[]) => a.length === b.length && a.every((rect, rang) =>
  Math.abs(rect.x - b[rang].x) < 1 && Math.abs(rect.y - b[rang].y) < 1 && Math.abs(rect.l - b[rang].l) < 1 && Math.abs(rect.h - b[rang].h) < 1)

/** Un rectangle aux coins arrondis, en tracé SVG. */
function trou({ x, y, l, h }: Rect): string {
  const r = Math.min(12, l / 2, h / 2)
  return `M${x + r} ${y}H${x + l - r}A${r} ${r} 0 0 1 ${x + l} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + l - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`
}

export function CoachGuide({ vue, reveiller, passer }: {
  vue: Omit<VueDuGuide, 'lues'>
  /** Relire la partie tout de suite : le moteur vient de changer. */
  reveiller: () => void
  /** Quitter le guide, au premier lancement comme depuis les paramètres. */
  passer: () => void
}) {
  const [lues, setLues] = useState<ReadonlySet<BulleLue>>(() => new Set())
  const etape = etapeDuGuide({ ...vue, lues })
  const tour = vue.partie.turnNumber

  // Ce que l'étape demande au moteur, une seule fois par tour.
  const faites = useRef(new Set<string>())
  const action = etape?.action
  useEffect(() => {
    if (!action) return
    const cle = `${action}:${tour}`
    if (faites.current.has(cle)) return
    faites.current.add(cle)
    if (action === 'laisser-jouer-motman') laisserJouerMotMan(serverNow())
    else relancerLeChrono(serverNow())
    reveiller()
  }, [action, tour, reveiller])

  // Les fenêtres suivent leurs cibles : le chevalet change, la grille se recadre.
  const selecteurs = etape?.fenetres.join('|') ?? ''
  const [rects, setRects] = useState<Rect[]>([])
  const [ecran, setEcran] = useState(() => ({ l: window.innerWidth, h: window.innerHeight }))
  useLayoutEffect(() => {
    const liste = selecteurs ? selecteurs.split('|') : []
    const relever = () => {
      const suivants = mesurer(liste)
      setRects(courants => memesRects(courants, suivants) ? courants : suivants)
      setEcran(courant => courant.l === window.innerWidth && courant.h === window.innerHeight ? courant : { l: window.innerWidth, h: window.innerHeight })
    }
    relever()
    const image = window.requestAnimationFrame(relever)
    // Pas d'animation continue (motman-lag-android-gpu) : un relevé toutes les 400 ms suffit.
    const minuterie = window.setInterval(relever, 400)
    window.addEventListener('resize', relever)
    return () => { window.cancelAnimationFrame(image); window.clearInterval(minuterie); window.removeEventListener('resize', relever) }
  }, [selecteurs])

  // La bulle qui attend un bouton prend le focus, comme une fenêtre.
  const bulleRef = useRef<HTMLDivElement>(null)
  const boutonActif = Boolean(etape?.bouton?.actif)
  useEffect(() => {
    if (boutonActif) bulleRef.current?.querySelector<HTMLButtonElement>('.guide-bulle-suivant')?.focus({ preventScroll: true })
  }, [etape?.id, boutonActif])

  if (!etape) return null
  const avecBulle = Boolean(etape.texte)

  // La bulle dans le plus grand espace libre, au-dessus ou au-dessous des fenêtres.
  const haut = rects.length ? Math.min(...rects.map(rect => rect.y)) : ecran.h / 2
  const bas = rects.length ? Math.max(...rects.map(rect => rect.y + rect.h)) : ecran.h / 2
  const dessous = ecran.h - bas >= haut
  const placeBulle: CSSProperties = dessous
    ? { top: Math.min(bas + 12, ecran.h - 150) }
    : { bottom: Math.min(ecran.h - haut + 12, ecran.h - 150) }

  return <div className="guide-couche" data-etape={etape.id}>
    <svg className={`guide-voile ${avecBulle ? '' : 'is-transparent'}`} width={ecran.l} height={ecran.h} aria-hidden="true">
      <path d={`M0 0H${ecran.l}V${ecran.h}H0Z${rects.map(trou).join('')}`} fillRule="evenodd" />
    </svg>
    {avecBulle ? <div ref={bulleRef} className="guide-bulle" style={placeBulle} role="status" aria-live="polite">
      {etape.titre ? <strong>{etape.titre}</strong> : null}
      <p>{etape.texte}</p>
      <div className="guide-bulle-pied">
        <button type="button" className="guide-bulle-passer" onClick={passer}>Passer le tutoriel</button>
        {etape.bouton ? <button type="button" className="guide-bulle-suivant" disabled={!etape.bouton.actif}
          onClick={() => setLues(courantes => new Set([...courantes, etape.bouton!.lue]))}>{etape.bouton.libelle}</button> : null}
      </div>
    </div> : null}
  </div>
}
