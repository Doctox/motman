import { useEffect, useLayoutEffect, useReducer, useRef, useState, type CSSProperties } from 'react'
import { BookOpen, Check, Clock, Gamepad2, Lightbulb } from 'lucide-react'
import { motionReduced } from '../sensoryPreferences'
import { useDialogFocus } from '../useDialogFocus'
import { COUP_ADVERSE, ESSAI_COLONNES, ESSAI_GRILLE, ESSAI_RANGEES, etatInitial, jouerEssai, MOT_DU_JOUEUR, type EtatEssai } from './essaiRegles'
import './menu-essai.css'

// La partie d'essai : voir essaiRegles.ts pour le déroulé et les règles dites.
// Un voile sombre couvre l'écran ; des « fenêtres » laissent voir ce qu'il faut
// toucher. Le voile ne capte aucun toucher : c'est la logique qui ignore ce qui
// n'est pas encore demandé. La bulle vit toujours au même endroit, entre la
// grille et le chevalet : l'œil ne la cherche pas.

type Bulle = { fenetres: string[]; titre?: string; texte: string; bouton?: string }

function bulleDe(etat: EtatEssai, coupAdverseJoue: boolean): Bulle | null {
  switch (etat.etape) {
    case 'lire': return {
      fenetres: ['[data-essai-case="0"]'],
      titre: 'Bienvenue dans MotMan',
      texte: 'Le mot fléché en duel : deux joueurs, une même grille. Les cases colorées donnent les définitions, et la flèche montre où s’écrit la réponse.',
      bouton: 'Compris',
    }
    case 'choisir': return { fenetres: ['[data-essai="lettre-c"]'], texte: 'Le mot qui miaule commence par un C. Touche la lettre C.' }
    case 'poser': return { fenetres: [`[data-essai-case="${MOT_DU_JOUEUR[0]}"]`], texte: 'Puis touche la première case du mot.' }
    case 'completer': return {
      fenetres: ['.essai-mot-joueur', '.essai-chevalet'],
      texte: etat.erreur
        ? 'Une lettre fausse ne coûte aucun point : elle revient sur ton chevalet. Essaie une autre lettre.'
        : 'Pose H, A et T de la même façon. Pour reprendre une lettre, touche-la.',
    }
    case 'valider': return { fenetres: ['.essai-valider'], texte: 'Le mot est complet : touche Valider pour jouer ton coup.' }
    case 'bravo': return {
      fenetres: ['.essai-mot-joueur', '.essai-score-moi'],
      titre: `Bravo, +${etat.gain} points !`,
      texte: '1 point par lettre juste, et le mot complet en rapporte autant qu’il a de lettres.',
      bouton: 'Suivant',
    }
    case 'adversaire': return {
      fenetres: ['.essai-mot-adverse', '.essai-score-adverse'],
      titre: 'Au tour de ton adversaire',
      texte: coupAdverseJoue
        ? 'Ses lettres sont en terre cuite, les tiennes en vert. Quand la grille est pleine, le meilleur score gagne.'
        : 'Il pose ses lettres sur la même grille…',
      bouton: 'Suivant',
    }
    case 'conseils': return null
  }
}

type Fenetre = { x: number; y: number; l: number; h: number }

/** Le rectangle qui englobe tout ce que désigne `selecteur`, en coordonnées d'écran. */
function rectangleDe(racine: HTMLElement, selecteur: string, marge = 2): Fenetre | null {
  const elements = [...racine.querySelectorAll<HTMLElement>(selecteur)]
  if (!elements.length) return null
  const boites = elements.map(element => element.getBoundingClientRect())
  const gauche = Math.min(...boites.map(boite => boite.left)) - marge
  const haut = Math.min(...boites.map(boite => boite.top)) - marge
  const droite = Math.max(...boites.map(boite => boite.right)) + marge
  const bas = Math.max(...boites.map(boite => boite.bottom)) + marge
  return { x: gauche, y: haut, l: droite - gauche, h: bas - haut }
}

export function PartieDEssai({ premiere, jouer, fermer }: {
  /** Tout premier lancement : la fin propose de lancer la vraie partie. */
  premiere: boolean
  /** « Jouer ma première partie » : lance la recherche (N1). */
  jouer: () => void
  /** « Passer », « Plus tard » ou « Fermer ». */
  fermer: () => void
}) {
  const [etat, envoyer] = useReducer(jouerEssai, undefined, etatInitial)
  const coucheRef = useDialogFocus<HTMLDivElement>(fermer)
  const [fenetres, setFenetres] = useState<Fenetre[]>([])
  const [montrees, setMontrees] = useState(0)
  const coupAdverseJoue = COUP_ADVERSE.every(coup => etat.validees[coup.cellule])
  const bulle = bulleDe(etat, coupAdverseJoue)

  // MotMan pose ses trois lettres l'une après l'autre, puis le coup compte.
  useEffect(() => {
    if (etat.etape !== 'adversaire' || coupAdverseJoue) return
    if (motionReduced()) { setMontrees(COUP_ADVERSE.length); envoyer({ type: 'adversaire-fini' }); return }
    let compte = 0
    const minuterie = window.setInterval(() => {
      compte += 1
      setMontrees(compte)
      if (compte < COUP_ADVERSE.length) return
      window.clearInterval(minuterie)
      window.setTimeout(() => envoyer({ type: 'adversaire-fini' }), 450)
    }, 650)
    return () => window.clearInterval(minuterie)
  }, [etat.etape, coupAdverseJoue])

  // Les fenêtres du voile suivent leurs cibles, au défilement comme à la rotation.
  const selecteurs = bulle?.fenetres.join('|') ?? ''
  useLayoutEffect(() => {
    const couche = coucheRef.current
    if (!couche || !selecteurs) { setFenetres([]); return }
    const mesurer = () => setFenetres(selecteurs.split('|').map(selecteur => rectangleDe(couche, selecteur)).filter((fenetre): fenetre is Fenetre => Boolean(fenetre)))
    mesurer()
    const image = window.requestAnimationFrame(mesurer)
    window.addEventListener('resize', mesurer)
    couche.addEventListener('scroll', mesurer, { passive: true })
    return () => { window.cancelAnimationFrame(image); window.removeEventListener('resize', mesurer); couche.removeEventListener('scroll', mesurer) }
  }, [coucheRef, selecteurs, etat.erreur])

  // Une bulle qui attend un « Compris » ou un « Suivant » prend le focus : au
  // clavier comme au lecteur d'écran, on n'a pas à la chercher.
  const bulleRef = useRef<HTMLDivElement>(null)
  useEffect(() => { bulleRef.current?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true }) }, [etat.etape])

  const lettreAffichee = (cellule: number): { lettre: string; classe: string } | null => {
    const validee = etat.validees[cellule]
    if (validee) return { lettre: validee.lettre, classe: validee.joueur === 'moi' ? 'is-mine' : 'is-theirs' }
    const posee = etat.posees[cellule]
    if (posee) return { lettre: posee.lettre, classe: 'is-pending' }
    const index = COUP_ADVERSE.findIndex(coup => coup.cellule === cellule)
    if (index >= 0 && index < montrees) return { lettre: COUP_ADVERSE[index].lettre, classe: 'is-theirs is-arriving' }
    return null
  }
  const placeDuC = etat.chevalet.indexOf('C')

  return <div ref={coucheRef} className="mm-modal-layer essai-layer" role="dialog" aria-modal="true" aria-label="Partie d’essai" tabIndex={-1}>
    <div className="essai-shell">
      <header className="essai-header">
        <span><Gamepad2 aria-hidden="true" />Partie d’essai</span>
        {etat.etape !== 'conseils' ? <button type="button" className="essai-passer" onClick={fermer}>Passer</button> : null}
      </header>

      <div className="essai-scores">
        <div className="essai-score essai-score-adverse"><small>MotMan</small><strong>{etat.scores.adversaire}</strong></div>
        <div className="essai-score essai-score-moi"><small>Toi</small><strong>{etat.scores.moi}</strong></div>
      </div>

      <div className="essai-grille" style={{ '--essai-colonnes': ESSAI_COLONNES, '--essai-rangees': ESSAI_RANGEES } as CSSProperties}>
        {ESSAI_GRILLE.map((contenu, cellule) => {
          if (contenu.kind === 'definition') return <div key={cellule} data-essai-case={cellule} className={`essai-case essai-definition essai-ton-${Math.floor(cellule / ESSAI_COLONNES)}`}>
            <span>{contenu.texte}</span><b aria-hidden="true">→</b>
          </div>
          if (contenu.kind === 'pleine') return <div key={cellule} className="essai-case essai-pleine" aria-hidden="true" />
          const affichee = lettreAffichee(cellule)
          const duJoueur = MOT_DU_JOUEUR.includes(cellule)
          return <button key={cellule} type="button" data-essai-case={cellule}
            className={`essai-case essai-lettre ${duJoueur ? 'essai-mot-joueur' : 'essai-mot-adverse'} ${affichee?.classe ?? ''}`}
            aria-label={`${duJoueur ? 'Il miaule' : 'Il aime le fromage'}, case ${MOT_DU_JOUEUR.includes(cellule) ? MOT_DU_JOUEUR.indexOf(cellule) + 1 : cellule - ESSAI_COLONNES}${affichee ? ` · ${affichee.lettre}${affichee.classe === 'is-pending' ? ' posée' : ' validée'}` : ' · vide'}`}
            onClick={() => envoyer({ type: 'case', cellule })}>
            {affichee ? <span>{affichee.lettre}</span> : null}
          </button>
        })}
      </div>

      <div ref={bulleRef} className={`essai-bulle ${bulle ? '' : 'is-empty'}`} role="status" aria-live="polite">
        {bulle ? <>
          {bulle.titre ? <strong>{bulle.titre}</strong> : null}
          <p>{bulle.texte}</p>
          {bulle.bouton ? <button type="button" data-dialog-autofocus disabled={etat.etape === 'adversaire' && !coupAdverseJoue} onClick={() => envoyer({ type: 'suivant' })}>{bulle.bouton}</button> : null}
        </> : null}
      </div>

      <div className="essai-chevalet" aria-label="Tes lettres">
        {etat.chevalet.map((lettre, place) => lettre
          ? <button key={place} type="button" data-essai={place === placeDuC ? 'lettre-c' : undefined}
            className={`essai-tuile ${etat.choisie === place ? 'is-chosen' : ''}`} aria-pressed={etat.choisie === place} aria-label={`Lettre ${lettre}`}
            onClick={() => envoyer({ type: 'lettre', place })}>{lettre}</button>
          : <span key={place} className="essai-tuile-vide" aria-hidden="true" />)}
      </div>
      <button type="button" className="essai-valider" disabled={!Object.keys(etat.posees).length} onClick={() => envoyer({ type: 'valider' })}><Check aria-hidden="true" />Valider</button>
    </div>

    {fenetres.length ? <svg className="essai-voile" aria-hidden="true" width="100%" height="100%">
      <defs><mask id="essai-trous">
        <rect width="100%" height="100%" fill="#fff" />
        {fenetres.map((fenetre, index) => <rect key={index} x={fenetre.x} y={fenetre.y} width={fenetre.l} height={fenetre.h} rx="14" fill="#000" />)}
      </mask></defs>
      <rect width="100%" height="100%" mask="url(#essai-trous)" />
      {fenetres.map((fenetre, index) => <rect key={index} className="essai-contour" x={fenetre.x} y={fenetre.y} width={fenetre.l} height={fenetre.h} rx="14" />)}
    </svg> : null}

    {etat.etape === 'conseils' ? <section className="essai-fin" aria-labelledby="essai-fin-titre">
      <small>Avant de commencer</small>
      <h2 id="essai-fin-titre">Prends ton temps</h2>
      <ul>
        <li><Clock aria-hidden="true" />Une partie dure une dizaine de minutes.</li>
        <li><BookOpen aria-hidden="true" />Avant ton premier tour, tu as 30 secondes pour lire la grille.</li>
        <li><Check aria-hidden="true" />Une lettre fausse ne coûte aucun point.</li>
        <li><Lightbulb aria-hidden="true" />Bloqué ? L’indice pose une lettre juste, sans point.</li>
      </ul>
      {premiere
        ? <>
          <button type="button" className="essai-fin-jouer" data-dialog-autofocus onClick={jouer}><Gamepad2 aria-hidden="true" />Jouer ma première partie</button>
          <button type="button" className="essai-fin-plus-tard" onClick={fermer}>Plus tard</button>
        </>
        : <button type="button" className="essai-fin-jouer" data-dialog-autofocus onClick={fermer}>C’est compris</button>}
    </section> : null}
  </div>
}
