import { describe, expect, it } from 'vitest'
import { socialActionRoute } from './socialActionPolicy'

describe('routage des actions sociales', () => {
  it('charge l’état social sans exiger de joueur cible', () => {
    expect(socialActionRoute('state')).toBe('state')
  })

  it.each(['cancel', 'remove', 'block', 'unblock', 'report'])(
    'réserve %s aux actions visant un joueur',
    action => {
      expect(socialActionRoute(action)).toBe('target')
    },
  )

  it('ne transforme pas une action inconnue en action visant un joueur', () => {
    expect(socialActionRoute('inconnue')).toBe('unknown')
  })

  // Les avertissements que le joueur a REÇUS : sa propre boîte, pas la
  // modération. Confondre les deux ouvrirait la file des signalements à tout
  // le monde — la route décide du contrôle de rôle côté serveur.
  it.each(['warnings-list', 'warnings-ack'])('range %s dans sa propre boîte', action => {
    expect(socialActionRoute(action)).toBe('warnings')
  })

  it.each(['moderation-list', 'moderation-resolve'])('garde %s du côté modération', action => {
    expect(socialActionRoute(action)).toBe('moderation')
  })
})
