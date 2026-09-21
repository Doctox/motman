import { useEffect, useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import { acknowledgeWarnings, loadMyWarnings, type PlayerWarning } from '../social'
import './menu-moderation.css'

// ─────────────────────────────────────────────────────────────────────────────
// LE PREMIER MESSAGE QUE MOTMAN ADRESSE À UNE SEULE PERSONNE (21/09/2026)
//
// Jusqu'ici l'appli ne savait parler qu'à TOUS les joueurs à la fois : les
// nouveautés sont écrites dans le build, les mêmes pour tout le monde. Un
// joueur signalé ne pouvait donc rien apprendre — et le propriétaire n'avait
// « aucun moyen de communiquer avec le compte ».
//
// L'avertissement paraît DANS L'ENVELOPPE, au-dessus des nouveautés : c'est
// déjà l'endroit où le joueur va lire ce que le jeu a à lui dire, et la piste
// de pastilles y mène (roue crantée → enveloppe).
//
// LU, MAIS PAS EFFACÉ. Ouvrir la page marque l'avertissement lu ; la ligne,
// elle, reste en base — c'est elle qui se cumule et qui fondera un
// bannissement au troisième. Le joueur garde donc son message sous les yeux
// tant qu'il revient le lire, et la modération garde son décompte.
//
// Le texte vient du SERVEUR, tel qu'il a été écrit le jour de l'envoi : un
// message déjà reçu ne change pas de sens parce qu'on a réécrit une constante.
// ─────────────────────────────────────────────────────────────────────────────

const JOUR = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', timeZone: 'Europe/Paris' })

export function AvertissementsRecus({ charger = loadMyWarnings, marquerLu = acknowledgeWarnings }: {
  /** Injectables pour montrer l'écran — et le tenir par un test — sans réseau. */
  charger?: () => Promise<PlayerWarning[]>
  marquerLu?: () => Promise<void>
} = {}) {
  const [recus, setRecus] = useState<PlayerWarning[]>([])

  useEffect(() => {
    let vivant = true
    charger()
      .then(lignes => {
        if (!vivant || !lignes.length) return
        setRecus(lignes)
        // Vus : la pastille s'éteint. Silencieux en cas d'échec — un compteur
        // qui ne s'éteint pas ne doit pas empêcher de lire le message.
        void marquerLu().catch(() => undefined)
      })
      // Un joueur hors ligne, ou sans session, lit ses nouveautés comme avant.
      .catch(() => undefined)
    return () => { vivant = false }
  }, [charger, marquerLu])

  if (!recus.length) return null

  return (
    <section className="mm-avertissements" aria-label="Messages de la modération">
      {recus.map(avertissement => (
        <article key={avertissement.id}>
          <h3><ShieldAlert aria-hidden="true" />Avertissement</h3>
          <small>{JOUR.format(new Date(avertissement.created_at))}</small>
          {avertissement.message.split('\n').map((ligne, index) => (
            ligne ? <p key={index}>{ligne}</p> : null
          ))}
        </article>
      ))}
    </section>
  )
}
