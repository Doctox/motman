import { Gift, Leaf, Palette, Shapes, Smile, Sparkles, UserPlus, X } from 'lucide-react'
import { NOM_ABONNEMENT, PARTIES_OFFERTES_A_UN_AMI, type EtatAbonnement } from '../abonnement'
import { useDialogFocus } from '../useDialogFocus'
import { LogoMotManPlus } from './LogoMotManPlus'
import './menu-abonnement.css'

// ─────────────────────────────────────────────────────────────────────────────
// LA FICHE DE MOTMAN+ — ce qui arrive, ou ce qui est ouvert.
//
// Elle s'ouvre depuis l'onglet Thèmes, « Au calme », le profil et le choix de la
// couleur du pseudo. Tout le monde voit ce qui arrive, et rien ne s'y achète
// (décision du propriétaire, 05/11/2026).
// ─────────────────────────────────────────────────────────────────────────────

export function AbonnementPanel({ abonnement, nombreThemes, close, choisirCouleur }: {
  abonnement: EtatAbonnement
  nombreThemes: number
  close: () => void
  choisirCouleur: () => void
}) {
  const dialogRef = useDialogFocus<HTMLElement>(close)
  return <div className="mm-modal-layer mm-plus-layer" role="presentation" onMouseDown={event => event.target === event.currentTarget && close()}>
    <section ref={dialogRef} className="mm-plus-panel" role="dialog" aria-modal="true" aria-label={NOM_ABONNEMENT} tabIndex={-1}>
      {abonnement.actif
        ? <VueOuverte nombreThemes={nombreThemes} close={close} choisirCouleur={choisirCouleur} />
        : <VueAVenir nombreThemes={nombreThemes} close={close} />}
    </section>
  </div>
}

function Entete({ close, titre, accroche }: { close: () => void; titre: string; accroche: string }) {
  return <header className="mm-plus-hero">
    <button type="button" className="mm-plus-close" onClick={close} aria-label="Fermer"><X /></button>
    <small>{titre}</small>
    <h2><LogoMotManPlus /></h2>
    <p>{accroche}</p>
  </header>
}

function Avantages({ nombreThemes }: { nombreThemes: number }) {
  return <ul className="mm-plus-perks">
    <li><span aria-hidden="true"><Shapes /></span><div><strong>Les {nombreThemes} thèmes à volonté</strong><small>Choisis ton thème et joue à ton niveau, quand tu veux.</small></div></li>
    <li><span aria-hidden="true"><Leaf /></span><div><strong>La partie au calme</strong><small>Sans chrono, à ton rythme : personne ne t’attend.</small></div></li>
    <li><span aria-hidden="true"><Smile /></span><div><strong>Des emotes en partie</strong><small>Coucou, pouce, bravo, bonne chance : un mot à ton adversaire, sans rien écrire.</small></div></li>
    <li><span aria-hidden="true"><Palette /></span><div><strong>Ton pseudo en couleur</strong><small>Huit couleurs ou le néon, dès le premier jour. Tous tes adversaires le voient.</small></div></li>
    <li><span aria-hidden="true"><Gift /></span><div><strong>Un objet exclusif chaque mois</strong><small>Un avatar, un cadre ou une animation, réservé aux abonnés.</small></div></li>
    <li><span aria-hidden="true"><UserPlus /></span><div><strong>Fais découvrir tes thèmes</strong><small>Un ami sans abonnement joue {PARTIES_OFFERTES_A_UN_AMI} parties à thème, offertes.</small></div></li>
  </ul>
}

function VueAVenir({ nombreThemes, close }: { nombreThemes: number; close: () => void }) {
  return <>
    <div className="mm-plus-scroll">
      <Entete close={close} titre="L’abonnement" accroche="On y travaille en ce moment." />
      <Avantages nombreThemes={nombreThemes} />
    </div>
    <footer className="mm-plus-foot">
      <strong className="mm-plus-bientot"><Sparkles aria-hidden="true" />Bientôt</strong>
      <p>Tu le verras dans les nouveautés dès qu’il est prêt.</p>
    </footer>
  </>
}

function VueOuverte({ nombreThemes, close, choisirCouleur }: { nombreThemes: number; close: () => void; choisirCouleur: () => void }) {
  return <div className="mm-plus-scroll">
    <Entete close={close} titre="Ton abonnement" accroche="Tout est ouvert sur ton compte." />
    <div className="mm-plus-block">
      <button type="button" className="mm-plus-secondary" onClick={choisirCouleur}><Palette />Choisir la couleur de mon pseudo</button>
    </div>
    <Avantages nombreThemes={nombreThemes} />
  </div>
}
