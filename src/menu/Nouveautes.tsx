import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { marquerNouveauteLue, NOUVEAUTES, useNouveautesLues, type Nouveaute } from '../nouveautes'
import './menu-nouveautes.css'

const JOUR = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', timeZone: 'Europe/Paris' })

function dateAffichee(date: string): string {
  // Midi : une date « AAAA-MM-JJ » lue à minuit UTC tomberait la veille en
  // Europe/Paris l'hiver comme l'été selon l'heure de lecture. Midi ne bouge pas.
  return JOUR.format(new Date(`${date}T12:00:00Z`))
}

function Entree({ entree, lue }: { entree: Nouveaute; lue: boolean }) {
  const [ouverte, setOuverte] = useState(false)
  const basculer = () => {
    // C'est EN OUVRANT l'entrée qu'elle passe lue : pas en survolant la liste.
    if (!ouverte) marquerNouveauteLue(entree.id)
    setOuverte(!ouverte)
  }
  return <li className={`mm-nouveaute ${ouverte ? 'is-open' : ''}`}>
    <button type="button" aria-expanded={ouverte} onClick={basculer}>
      <span>
        <small>{dateAffichee(entree.date)}</small>
        <strong>{entree.titre}</strong>
      </span>
      {lue ? null : <i className="mm-pastille" aria-label="Pas encore lue" />}
      <ChevronDown aria-hidden="true" />
    </button>
    {ouverte ? <p>{entree.texte}</p> : null}
  </li>
}

export function NouveautesListe() {
  const lues = useNouveautesLues()
  return <ol className="mm-nouveautes">
    {NOUVEAUTES.map(entree => <Entree key={entree.id} entree={entree} lue={lues.has(entree.id)} />)}
  </ol>
}
