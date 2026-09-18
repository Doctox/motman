import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { marquerNouveauteLue, useNouveautes, type Nouveaute } from '../nouveautes'
import './menu-nouveautes.css'

const JOUR = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', timeZone: 'Europe/Paris' })

function dateAffichee(date: string): string {
  // Midi : une date « AAAA-MM-JJ » lue à minuit UTC tomberait la veille selon
  // l'heure de lecture. Midi ne bouge pas.
  return JOUR.format(new Date(`${date}T12:00:00Z`))
}

function Message({ message, lu }: { message: Nouveaute; lu: boolean }) {
  const [ouvert, setOuvert] = useState(false)
  const basculer = () => {
    // C'est EN OUVRANT le message qu'il passe lu : pas en survolant la liste.
    if (!ouvert) marquerNouveauteLue(message.id)
    setOuvert(!ouvert)
  }
  // Replié, le message annonce ce qu'il contient ; déplié, il en dit plus.
  const resume = message.rapports.map(rapport => rapport.titre).join(' · ')
  return <li className={`mm-nouveaute ${ouvert ? 'is-open' : ''}`}>
    <button type="button" aria-expanded={ouvert} onClick={basculer}>
      <span>
        {/* Deux rendez-vous par jour : l'heure distingue deux messages du même jour. */}
        <small>{dateAffichee(message.date)} · {message.heure} h</small>
        <strong>{resume}</strong>
      </span>
      {lu ? null : <i className="mm-pastille" aria-label="Pas encore lu" />}
      <ChevronDown aria-hidden="true" />
    </button>
    {ouvert ? <ul>
      {message.rapports.map(rapport => <li key={rapport.ajoute + rapport.titre}>
        <strong>{rapport.titre}</strong>
        <p>{rapport.texte}</p>
      </li>)}
    </ul> : null}
  </li>
}

export function NouveautesListe() {
  const { lues, publiees } = useNouveautes()
  if (!publiees.length) return <p className="mm-nouveautes-vide">Rien de neuf pour l’instant.</p>
  return <ol className="mm-nouveautes">
    {publiees.map(message => <Message key={message.id} message={message} lu={lues.has(message.id)} />)}
  </ol>
}
