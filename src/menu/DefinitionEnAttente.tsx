import { useEffect, useRef, useState } from 'react'
import { haptic } from '../sensoryPreferences'
import { lecture, lettresMelangees, ordreDesMots, poser, retirer, verdict, type Tuile } from './reserveEnAttente'
import './menu-attente.css'

// Une définition à deviner pendant qu'on attend un adversaire (B2, 15/10/2026 ;
// la réserve et ses règles sont dans reserveEnAttente.ts). Sans enjeu : rien
// n'est envoyé au serveur, rien ne se gagne.

const ORDRE = ordreDesMots()
/** Où l'on en est dans la réserve : la prochaine attente reprend au mot suivant. */
const CLE_CURSEUR = 'motman:attente-curseur'
/** Combien de mots trouvés depuis l'ouverture de l'appli (changer d'onglet ne remet pas à zéro). */
let trouvesCetteSession = 0

function lireCurseur(): number {
  try {
    const n = Number(localStorage.getItem(CLE_CURSEUR))
    return Number.isInteger(n) && n >= 0 ? n % ORDRE.length : 0
  } catch { return 0 }
}

function ecrireCurseur(n: number): void {
  try { localStorage.setItem(CLE_CURSEUR, String(n)) } catch { /* sans mémoire, on repart du début */ }
}

function table(curseur: number): Tuile[] {
  return lettresMelangees(ORDRE[curseur].mot, curseur + 1).map(lettre => ({ lettre, case: null }))
}

type Etat = 'jeu' | 'trouve' | 'rate' | 'revele'

export function DefinitionEnAttente() {
  const [curseur, setCurseur] = useState(lireCurseur)
  const [tuiles, setTuiles] = useState<Tuile[]>(() => table(curseur))
  const [etat, setEtat] = useState<Etat>('jeu')
  const [trouves, setTrouves] = useState(trouvesCetteSession)
  const minuteur = useRef(0)
  const { mot, definition } = ORDRE[curseur]

  useEffect(() => () => window.clearTimeout(minuteur.current), [])

  const suivant = () => {
    const n = (curseur + 1) % ORDRE.length
    ecrireCurseur(n)
    setCurseur(n)
    setTuiles(table(n))
    setEtat('jeu')
  }

  const plusTard = (attente: number, ensuite: () => void) => {
    window.clearTimeout(minuteur.current)
    minuteur.current = window.setTimeout(ensuite, attente)
  }

  const jouer = (indice: number) => {
    if (etat !== 'jeu') return
    const apres = poser(tuiles, indice, mot.length)
    setTuiles(apres)
    const juste = verdict(apres, mot)
    if (juste === true) {
      trouvesCetteSession += 1
      setTrouves(trouvesCetteSession)
      setEtat('trouve')
      haptic(12)
      plusTard(1100, suivant)
    } else if (juste === false) {
      // Comme une erreur en partie (A5) : les cases pâlissent, sans secousse.
      setEtat('rate')
      plusTard(700, () => { setTuiles(t => t.map(tuile => ({ ...tuile, case: null }))); setEtat('jeu') })
    }
  }

  // « Une autre » montre d'abord la réponse : on passe, mais on apprend.
  const passer = () => {
    if (etat !== 'jeu') return
    setTuiles([...mot].map((lettre, i) => ({ lettre, case: i })))
    setEtat('revele')
    plusTard(1400, suivant)
  }

  const cases = lecture(tuiles, mot.length)
  const message = etat === 'trouve' ? 'Bien vu !' : etat === 'rate' ? 'Pas tout à fait…' : etat === 'revele' ? `C’était ${mot}.` : ''

  return <section className={`mm-attente is-${etat}`} aria-label="Une définition, en attendant">
    <div className="mm-attente-tete">
      <small>En attendant…</small>
      {trouves ? <small className="mm-attente-compte">{trouves} trouvé{trouves > 1 ? 's' : ''}</small> : null}
    </div>
    <p className="mm-attente-definition">{definition}</p>
    <div className="mm-attente-cases" role="group" aria-label={`Réponse en ${mot.length} lettres`}>
      {cases.map((lettre, i) => <button
        type="button"
        key={i}
        className={`mm-attente-case ${lettre ? 'is-pleine' : ''}`}
        aria-label={lettre ? `Case ${i + 1} : ${lettre}. Toucher pour l’enlever` : `Case ${i + 1}, vide`}
        // Pas `disabled` : le menu pâlit tout bouton désactivé (menu-attente.css).
        aria-disabled={!lettre || etat !== 'jeu'}
        onClick={() => { if (lettre && etat === 'jeu') setTuiles(t => retirer(t, i)) }}
      >{lettre}</button>)}
    </div>
    <div className="mm-attente-lettres" role="group" aria-label="Lettres à placer">
      {tuiles.map((tuile, i) => <button
        type="button"
        key={`${curseur}-${i}`}
        className="mm-attente-lettre"
        aria-label={`Lettre ${tuile.lettre}`}
        disabled={tuile.case !== null || etat !== 'jeu'}
        onClick={() => jouer(i)}
      >{tuile.lettre}</button>)}
    </div>
    <div className="mm-attente-pied">
      <span role="status" aria-live="polite">{message}</span>
      <button type="button" className="mm-attente-autre" disabled={etat !== 'jeu'} onClick={passer}>Une autre</button>
    </div>
  </section>
}
