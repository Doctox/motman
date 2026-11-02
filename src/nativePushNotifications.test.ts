// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ecouterLesNotificationsTouchees, pushNotificationRoute } from './nativePushNotifications'

const natif = vi.hoisted(() => ({
  ecoutes: new Map<string, (action: { notification: { data: unknown } }) => void>(),
  actif: { valeur: false },
}))

vi.mock('./nativeRuntime', () => ({ isNativeRuntime: () => natif.actif.valeur }))
vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    addListener: vi.fn(async (nom: string, ecoute: (action: { notification: { data: unknown } }) => void) => { natif.ecoutes.set(nom, ecoute) }),
  },
}))

describe('navigation depuis une notification native', () => {
  it('ouvre directement la partie indiquée', () => {
    expect(pushNotificationRoute({ type: 'match_turn', matchId: '4b8a3f49-c8b4-4b12-94e7-6ece8825831f' }))
      .toBe('#partie=4b8a3f49-c8b4-4b12-94e7-6ece8825831f')
  })

  it('ouvre Jouer pour une invitation sans partie créée', () => {
    expect(pushNotificationRoute({ type: 'friend_invitation', invitationId: 'invite-1' })).toBe('#jouer')
  })

  it('ouvre Jouer lorsqu’un adversaire classé est prêt', () => {
    expect(pushNotificationRoute({ type: 'ranked_ready', readySessionId: 'ready-1' })).toBe('#jouer')
  })

  it('ouvre la partie quand une invitation est acceptée', () => {
    expect(pushNotificationRoute({ type: 'invitation_accepted', matchId: '5e748f98-c0c1-4657-a865-4399f510ced1' }))
      .toBe('#partie=5e748f98-c0c1-4657-a865-4399f510ced1')
  })

  it('ignore une destination non reconnue', () => {
    expect(pushNotificationRoute({ type: 'unknown', matchId: '../profil' })).toBeNull()
  })
})

// 02/11/2026 : toucher une notification relançait tout le jeu, deux fois quand
// l'appli était fermée. L'adresse suffit au premier affichage, l'événement sert
// quand l'écran est déjà là.
describe('toucher une notification', () => {
  afterEach(() => { natif.actif.valeur = false })

  it('écrit la destination et prévient l’écran, sans recharger la page', async () => {
    natif.actif.valeur = true
    await ecouterLesNotificationsTouchees()
    const recues: string[] = []
    const ecoute = (event: Event) => recues.push((event as CustomEvent<string>).detail)
    window.addEventListener('motman:notification-touchee', ecoute)

    natif.ecoutes.get('pushNotificationActionPerformed')?.({ notification: { data: { type: 'match_turn', matchId: '4b8a3f49-c8b4-4b12-94e7-6ece8825831f' } } })
    window.removeEventListener('motman:notification-touchee', ecoute)

    expect(location.hash).toBe('#partie=4b8a3f49-c8b4-4b12-94e7-6ece8825831f')
    expect(recues).toEqual(['#partie=4b8a3f49-c8b4-4b12-94e7-6ece8825831f'])
  })

  it('n’écoute qu’une fois, même appelée au démarrage puis à l’initialisation', async () => {
    const premiere = ecouterLesNotificationsTouchees()
    expect(ecouterLesNotificationsTouchees()).toBe(premiere)
    await premiere
  })

  it('ne change rien pour une destination inconnue', () => {
    history.replaceState(null, '', '#accueil')
    natif.ecoutes.get('pushNotificationActionPerformed')?.({ notification: { data: { type: 'inconnu' } } })
    expect(location.hash).toBe('#accueil')
  })
})
