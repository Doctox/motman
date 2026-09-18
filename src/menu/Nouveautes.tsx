import { useState } from 'react'
import { CalendarHeart, ChevronDown, LayoutGrid, Sparkles, Type, type LucideIcon } from 'lucide-react'
import { marquerNouveauteLue, useNouveautes, type GenreDeRapport, type Nouveaute } from '../nouveautes'
import './menu-nouveautes.css'

// Chaque rapport porte une petite icône qui dit d'un coup d'œil de quoi il
// parle, comme sur la maquette validée par le propriétaire le 18/09/2026.
// Un rapport sans genre prend l'étincelle : « du nouveau », sans plus.
const ICONES: Record<GenreDeRapport, LucideIcon> = {
  theme: CalendarHeart,
  grilles: LayoutGrid,
  affichage: Type,
  jeu: Sparkles,
}

// Dans un message, le plus parlant passe devant : un thème ou des grilles
// avant un confort d'affichage. À genre égal, l'ordre de dépôt.
const PRIORITE: Record<GenreDeRapport, number> = { theme: 0, grilles: 1, jeu: 2, affichage: 3 }

const COURT = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Paris' })
const LONG = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Paris' })

function dateAffichee(date: string, format: Intl.DateTimeFormat): string {
  // Midi : une date « AAAA-MM-JJ » lue à minuit UTC tomberait la veille selon
  // l'heure de lecture. Midi ne bouge pas.
  const texte = format.format(new Date(`${date}T12:00:00Z`))
  return texte.charAt(0).toUpperCase() + texte.slice(1)
}

function Message({ message, lu }: { message: Nouveaute; lu: boolean }) {
  const [ouvert, setOuvert] = useState(false)
  const basculer = () => {
    // C'est EN OUVRANT le message qu'il passe lu : pas en survolant la liste.
    if (!ouvert) marquerNouveauteLue(message.id)
    setOuvert(!ouvert)
  }
  const rapports = [...message.rapports].sort((a, b) => PRIORITE[a.genre ?? 'jeu'] - PRIORITE[b.genre ?? 'jeu'])
  const [premier, ...suivants] = rapports
  const nombre = rapports.length
  return <li className={`mm-nouveaute ${ouvert ? 'is-open' : ''} ${lu ? '' : 'is-unread'}`}>
    <button type="button" aria-expanded={ouvert} onClick={basculer}>
      {ouvert
        // Ouvert : le jour en entier, et combien de nouveautés suivent.
        ? <span>
          <small>{dateAffichee(message.date, LONG)} · {message.heure} h</small>
          <em>{nombre} nouveauté{nombre > 1 ? 's' : ''}</em>
        </span>
        // Replié : la première nouveauté en vedette, les autres comptées.
        : <span>
          {/* Deux rendez-vous par jour : l'heure distingue deux messages du même jour. */}
          <small>{dateAffichee(message.date, COURT)} · {message.heure} h</small>
          <strong>{premier.titre}</strong>
          {suivants.length ? <em>et {suivants.length} autre{suivants.length > 1 ? 's' : ''} nouveauté{suivants.length > 1 ? 's' : ''}</em> : null}
        </span>}
      {lu ? null : <i className="mm-pastille" aria-label="Pas encore lu" />}
      <ChevronDown aria-hidden="true" />
    </button>
    {ouvert ? <ul>
      {rapports.map(rapport => {
        const Icone = ICONES[rapport.genre ?? 'jeu']
        return <li key={rapport.ajoute + rapport.titre}>
          <span className="mm-nouveaute-icone" data-genre={rapport.genre ?? 'jeu'} aria-hidden="true"><Icone /></span>
          <div>
            <strong>{rapport.titre}</strong>
            <p>{rapport.texte}</p>
          </div>
        </li>
      })}
    </ul> : null}
  </li>
}

export function NouveautesListe() {
  const { lues, publiees } = useNouveautes()
  if (!publiees.length) return <p className="mm-nouveautes-vide">Rien de neuf pour l’instant.</p>
  return <>
    <p className="mm-nouveautes-intro">Ce qui a changé dans MotMan.</p>
    <ol className="mm-nouveautes">
      {publiees.map(message => <Message key={message.id} message={message} lu={lues.has(message.id)} />)}
    </ol>
  </>
}
