import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { assetUrl } from '../assetUrl'
import { DUREE_BULLE_MS, EMOTES, envoiPossible, eventail, type Emote } from '../emotes'
import './emotes.css'

// ─────────────────────────────────────────────────────────────────────────────
// LES EMOTES EN PARTIE (src/emotes.ts pour les règles).
//
// Le joueur abonné appuie sur son portrait : quatre jetons s'ouvrent en éventail
// autour de lui. Il en touche un : l'éventail se replie et la bulle reste 2 s,
// à côté de son portrait pour une image, dans la bande libre sous sa carte pour
// « Bonne chance ! ». Tout se pose dans le corps de la page, en position fixe,
// d'après la place réelle du portrait : rien ne bouge dans le bandeau.
//
// L'envoi part au serveur, qui revérifie le droit et la cadence, puis le diffuse sur
// le canal de la partie. Tout joueur voit la bulle de l'autre, abonné ou non : elle
// sort du portrait de l'adversaire, à droite de lui. Si la diffusion se perd, personne
// n'en souffre : c'est une bulle de 2 s.
// ─────────────────────────────────────────────────────────────────────────────

type Ancre = { portrait: DOMRect; carte: DOMRect }
type Bulle = Ancre & { emote: Emote; cle: number }

/** Où est le portrait de l'adversaire, à l'instant où son emote arrive. */
function ancreDeLAdversaire(): Ancre | null {
  const carte = document.querySelector('.scoreboard .player:not(.player-you)')
  const portrait = carte?.querySelector('.game-portrait, .avatar')
  return carte && portrait ? { portrait: portrait.getBoundingClientRect(), carte: carte.getBoundingClientRect() } : null
}

export function useEmotesDeLaPartie(matchId: string, abonne: boolean, envoyerAuServeur: (emote: Emote['id']) => void): {
  ouvrir: ((portrait: HTMLElement) => void) | undefined
  calque: ReactNode
  /** L'emote de l'adversaire, arrivée par le temps réel. */
  recevoir: (emote: string) => void
} {
  const [ouvert, setOuvert] = useState<Ancre | null>(null)
  const [bulle, setBulle] = useState<Bulle | null>(null)
  const [bulleAdverse, setBulleAdverse] = useState<Bulle | null>(null)
  const envois = useRef<number[]>([])
  const minuterie = useRef<number | undefined>(undefined)
  const minuterieAdverse = useRef<number | undefined>(undefined)

  // Une nouvelle partie repart de zéro : compteur, éventail et bulle.
  useEffect(() => {
    envois.current = []
    setOuvert(null)
    setBulle(null)
    setBulleAdverse(null)
    return () => {
      window.clearTimeout(minuterie.current)
      window.clearTimeout(minuterieAdverse.current)
    }
  }, [matchId])

  const recevoir = useCallback((id: string) => {
    const emote = EMOTES.find(candidate => candidate.id === id)
    const ancre = ancreDeLAdversaire()
    if (!emote || !ancre) return
    setBulleAdverse({ ...ancre, emote, cle: Date.now() })
    window.clearTimeout(minuterieAdverse.current)
    minuterieAdverse.current = window.setTimeout(() => setBulleAdverse(null), DUREE_BULLE_MS)
  }, [])

  const ouvrir = useCallback((portrait: HTMLElement) => {
    const carte = portrait.closest('.player') ?? portrait
    setOuvert(actuel => actuel ? null : { portrait: portrait.getBoundingClientRect(), carte: carte.getBoundingClientRect() })
  }, [])

  const envoyer = (emote: Emote) => {
    if (!ouvert || !envoiPossible(envois.current, Date.now()).possible) return
    envois.current = [...envois.current, Date.now()]
    envoyerAuServeur(emote.id)
    setBulle({ ...ouvert, emote, cle: Date.now() })
    setOuvert(null)
    window.clearTimeout(minuterie.current)
    minuterie.current = window.setTimeout(() => setBulle(null), DUREE_BULLE_MS)
  }

  const calque = <>
    {ouvert ? createPortal(<Eventail ancre={ouvert} envois={envois.current} envoyer={envoyer} fermer={() => setOuvert(null)} />, document.body) : null}
    {bulle ? createPortal(<BulleEmote key={bulle.cle} bulle={bulle} />, document.body) : null}
    {bulleAdverse ? createPortal(<BulleEmote key={bulleAdverse.cle} bulle={bulleAdverse} adverse />, document.body) : null}
  </>
  return { ouvrir: abonne ? ouvrir : undefined, calque, recevoir }
}

function Eventail({ ancre, envois, envoyer, fermer }: { ancre: Ancre; envois: readonly number[]; envoyer: (emote: Emote) => void; fermer: () => void }) {
  const centreX = ancre.portrait.left + ancre.portrait.width / 2
  const centreY = ancre.portrait.top + ancre.portrait.height / 2
  const jetons = eventail(centreX, centreY, window.innerWidth)
  const etat = envoiPossible(envois, Date.now())
  const premier = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    premier.current?.focus({ preventScroll: true })
    const echap = (event: KeyboardEvent) => { if (event.key === 'Escape') fermer() }
    window.addEventListener('keydown', echap)
    return () => window.removeEventListener('keydown', echap)
  }, [fermer])
  return <div className="emotes-calque" role="presentation" onPointerDown={event => { if (event.target === event.currentTarget) fermer() }}>
    <div className="emotes-eventail" role="group" aria-label={etat.epuise ? 'Emotes : plus aucune pour cette partie' : 'Envoyer une emote'}>
      {EMOTES.map((emote, index) => {
        const { x, y, taille } = jetons[index]
        const style = { left: x - taille / 2, top: y - taille / 2, width: taille, height: taille, '--depuis-x': `${centreX - x}px`, '--depuis-y': `${centreY - y}px`, '--rang': index } as CSSProperties
        return <button ref={index === 0 ? premier : undefined} type="button" key={emote.id} className="emote-jeton" style={style} disabled={!etat.possible} aria-label={`Envoyer ${emote.nom}`} onClick={() => envoyer(emote)}>
          <img src={assetUrl(emote.image)} alt="" draggable={false} />
        </button>
      })}
    </div>
  </div>
}

function BulleEmote({ bulle, adverse = false }: { bulle: Bulle; adverse?: boolean }) {
  const { emote, portrait, carte } = bulle
  const cote = adverse ? 'is-adverse' : ''
  if (emote.texte) {
    // « Bonne chance ! » : dans la bande libre de 30 px entre la carte et la grille (26 px de haut,
    // posée 4 px sous la carte), la queue vers le portrait.
    const style = adverse
      ? { top: carte.bottom + 4, left: carte.left, '--queue': `${portrait.left + portrait.width / 2 - carte.left - 6}px` } as CSSProperties
      : { top: carte.bottom + 4, right: window.innerWidth - carte.right, '--queue': `${carte.right - (portrait.left + portrait.width / 2) - 6}px` } as CSSProperties
    return <div className={`emote-bulle-bd ${cote}`} style={style} role="status"><img src={assetUrl(emote.image)} alt="" /><span>{emote.texte.replace(/ !$/, '')}<i>&nbsp;!</i></span></div>
  }
  // Une image : la même bulle de BD (demande du 19/10/2026), à gauche du portrait, la queue vers lui ;
  // la main de Coucou y salue (emotes.css).
  const largeur = 54, hauteur = 46
  const style = { left: adverse ? portrait.right + 10 : portrait.left - largeur - 10, top: portrait.top + portrait.height / 2 - hauteur / 2, width: largeur, height: hauteur } as CSSProperties
  return <div className={`emote-bulle-bd emote-bulle-bd-image ${cote}`} style={style} role="status" aria-label={emote.nom}>
    <span className={emote.id === 'coucou' ? 'emote-image emote-salue' : 'emote-image'}><img src={assetUrl(emote.image)} alt="" /></span>
  </div>
}
