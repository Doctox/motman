import { assertEquals } from 'jsr:@std/assert@1'
import { decrireActivite, type PartieVue } from './onlinePlayers.ts'

// Ce que le propriétaire lit derrière « En ligne » (11/10/2026) : l'activité
// se déduit de l'état du serveur, jamais de ce que l'écran du joueur raconte.

const MOI = 'joueur'
const MAINTENANT = Date.parse('2026-10-11T18:00:00.000Z')

function partie(champs: Partial<PartieVue>): PartieVue {
  return {
    id: 'p', mode: 'normal', pace: 'realtime', status: 'active', turnNumber: 4, updatedAt: '2026-10-11T17:59:00.000Z',
    currentPlayerId: MOI, playerIds: [MOI, 'autre'], scores: { [MOI]: 21, autre: 13 }, bot: null, isDaily: false, dailyDate: null,
    ...champs,
  }
}

const decrire = (champs: Partial<Parameters<typeof decrireActivite>[0]>) => decrireActivite({
  joueurId: MOI, activitePresence: 'online', parties: [], rechercheClassee: null, rechercheNormale: null,
  nomsHumains: new Map([['autre', 'Tess89']]), maintenant: MAINTENANT, ...champs,
})

Deno.test('une partie en direct contre un humain : mode, adversaire, tour et score', () => {
  const { activite } = decrire({ parties: [partie({ mode: 'friend' })] })
  assertEquals(activite, { quoi: 'partie', mode: 'friend', rythme: 'realtime', defi: null, adversaire: { nom: 'Tess89', genre: 'humain' }, tour: 4, score: 21, scoreAdverse: 13, aSonTour: true })
})

Deno.test('le fantôme et les bots sont nommés comme tels pour le propriétaire', () => {
  const contreFantome = decrire({ parties: [partie({ mode: 'ranked', bot: { playerId: 'autre', displayName: 'DocTox', ghostOf: 'autre' } })] })
  assertEquals(contreFantome.activite.quoi === 'partie' && contreFantome.activite.adversaire, { nom: 'DocTox', genre: 'fantome' })
  const contreBot = decrire({ parties: [partie({ bot: { playerId: 'autre', displayName: 'Léa' } })] })
  assertEquals(contreBot.activite.quoi === 'partie' && contreBot.activite.adversaire, { nom: 'Léa', genre: 'bot' })
})

Deno.test('le défi du jour porte son thème, sans adversaire', () => {
  const { activite } = decrire({ parties: [partie({ mode: 'solo', isDaily: true, dailyDate: '2026-10-11', bot: { playerId: 'autre', displayName: 'Léa' } })] })
  assertEquals(activite.quoi === 'partie' && [activite.defi, activite.adversaire], [{ theme: 'Cuisine & Boissons' }, null])
})

Deno.test('la plus récente des parties en direct l’emporte, les parties en 24 h se comptent à part', () => {
  const { activite, partiesLentes } = decrire({
    parties: [
      partie({ id: 'vieille', mode: 'normal', updatedAt: '2026-10-11T17:00:00.000Z' }),
      partie({ id: 'recente', mode: 'ranked', updatedAt: '2026-10-11T17:59:50.000Z' }),
      partie({ id: 'lente', pace: 'async' }),
      partie({ id: 'finie', status: 'finished' }),
    ],
  })
  assertEquals(activite.quoi === 'partie' && activite.mode, 'ranked')
  assertEquals(partiesLentes, 1)
})

Deno.test('sans partie en direct : confirmation, recherche, écran de partie ou menu', () => {
  assertEquals(decrire({ rechercheClassee: { status: 'ready', createdAt: '2026-10-11T17:58:00.000Z' } }).activite, { quoi: 'confirmation' })
  assertEquals(decrire({ rechercheClassee: { status: 'searching', createdAt: '2026-10-11T17:58:40.000Z' } }).activite, { quoi: 'recherche', file: 'classee', depuisS: 80 })
  assertEquals(decrire({ rechercheNormale: { createdAt: '2026-10-11T17:59:48.000Z' } }).activite, { quoi: 'recherche', file: 'normale', depuisS: 12 })
  assertEquals(decrire({ activitePresence: 'playing' }).activite, { quoi: 'ecran-de-partie' })
  assertEquals(decrire({}).activite, { quoi: 'menu' })
})
