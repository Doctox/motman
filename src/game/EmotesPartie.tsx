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
// L'envoi à l'adversaire et l'affichage de ses emotes restent à brancher (canal
// temps réel de la partie, vérification de l'abonnement et de la cadence par le
// serveur).
// ─────────────────────────────────────────────────────────────────────────────

type Ancre = { portrait: DOMRect; carte: DOMRect }
type Bulle = Ancre & { emote: Emote; cle: number }

export function useEmotesDeLaPartie(matchId: string, abonne: boolean): { ouvrir: ((portrait: HTMLElement) => void) | undefined; calque: ReactNode } {
  const [ouvert, setOuvert] = useState<Ancre | null>(null)
  const [bulle, setBulle] = useState<Bulle | null>(null)
  const envois = useRef<number[]>([])
  const minuterie = useRef<number | undefined>(undefined)

  // Une nouvelle partie repart de zéro : compteur, éventail et bulle.
  useEffect(() => {
    envois.current = []
    setOuvert(null)
    setBulle(null)
    return () => window.clearTimeout(minuterie.current)
  }, [matchId])

  const ouvrir = useCallback((portrait: HTMLElement) => {
    const carte = portrait.closest('.player') ?? portrait
    setOuvert(actuel => actuel ? null : { portrait: portrait.getBoundingClientRect(), carte: carte.getBoundingClientRect() })
  }, [])

  const envoyer = (emote: Emote) => {
    if (!ouvert || !envoiPossible(envois.current, Date.now()).possible) return
    envois.current = [...envois.current, Date.now()]
    // À brancher : l'envoi au serveur, qui revérifie l'abonnement et la cadence.
    setBulle({ ...ouvert, emote, cle: Date.now() })
    setOuvert(null)
    window.clearTimeout(minuterie.current)
    minuterie.current = window.setTimeout(() => setBulle(null), DUREE_BULLE_MS)
  }

  const calque = <>
    {ouvert ? createPortal(<Eventail ancre={ouvert} envois={envois.current} envoyer={envoyer} fermer={() => setOuvert(null)} />, document.body) : null}
    {bulle ? createPortal(<BulleEmote key={bulle.cle} bulle={bulle} />, document.body) : null}
  </>
  return { ouvrir: abonne ? ouvrir : undefined, calque }
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

function BulleEmote({ bulle }: { bulle: Bulle }) {
  const { emote, portrait, carte } = bulle
  if (emote.texte) {
    // « Bonne chance ! » : dans la bande libre de 30 px entre la carte et la grille (26 px de haut,
    // posée 4 px sous la carte), la queue vers le portrait.
    const style = { top: carte.bottom + 4, right: window.innerWidth - carte.right, '--queue': `${carte.right - (portrait.left + portrait.width / 2) - 6}px` } as CSSProperties
    return <div className="emote-bulle-bd" style={style} role="status"><img src={assetUrl(emote.image)} alt="" /><span>{emote.texte.replace(/ !$/, '')}<i>&nbsp;!</i></span></div>
  }
  // Une image : la même bulle de BD (demande du 19/10/2026), à gauche du portrait, la queue vers lui ;
  // la main de Coucou y salue (emotes.css).
  const largeur = 54, hauteur = 46
  const style = { left: portrait.left - largeur - 10, top: portrait.top + portrait.height / 2 - hauteur / 2, width: largeur, height: hauteur } as CSSProperties
  return <div className="emote-bulle-bd emote-bulle-bd-image" style={style} role="status" aria-label={emote.nom}>
    <span className={emote.id === 'coucou' ? 'emote-image emote-salue' : 'emote-image'}><img src={assetUrl(emote.image)} alt="" /></span>
  </div>
}
