import { Capacitor } from '@capacitor/core'
import { invokeSupabaseFunction } from './supabaseFunctions'
import { isNativeRuntime } from './nativeRuntime'

const TOKEN_STORAGE_KEY = 'motman-push-token-v1'
let initialization: Promise<void> | null = null

export function pushNotificationRoute(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  const payload = data as Record<string, unknown>
  if (typeof payload.matchId === 'string' && /^[0-9a-f-]{36}$/i.test(payload.matchId)) {
    return `#partie=${encodeURIComponent(payload.matchId)}`
  }
  if (payload.type === 'ranked_ready') return '#jouer'
  // Recherche classée ouverte (alerte du propriétaire) : il vient en prendre une.
  if (payload.type === 'ranked_search') return '#jouer'
  if (payload.type === 'friend_invitation') return '#jouer'
  return null
}

/**
 * VIDER LE TIROIR DES NOTIFICATIONS (20/09/2026).
 *
 * Défaut relevé par le propriétaire : sa femme l'invite, il reçoit la
 * notification, il accepte DANS L'APPLI… et la notification reste dans le
 * tiroir du téléphone. Elle survivait à ce qu'elle annonçait, et le joueur la
 * balayait à la main — ou la retouchait plus tard pour rouvrir une partie déjà
 * jouée.
 *
 * La règle est simple : quand le joueur est DANS l'appli, les notifications
 * MotMan n'ont plus rien à lui apprendre — il voit ses parties, ses
 * invitations et ses tours à l'écran. On efface donc celles déjà délivrées à
 * l'ouverture et à chaque retour au premier plan.
 *
 * Sans effet hors natif, et silencieuse en cas d'échec : un tiroir qui ne se
 * vide pas ne doit jamais empêcher de jouer.
 */
export async function clearDeliveredPushNotifications(): Promise<void> {
  if (!isNativeRuntime()) return
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications')
    await PushNotifications.removeAllDeliveredNotifications()
  } catch {
    /* Le tiroir reste tel quel : sans conséquence sur la partie. */
  }
}

async function registerToken(token: string): Promise<void> {
  localStorage.setItem(TOKEN_STORAGE_KEY, token)
  await invokeSupabaseFunction('account-api', {
    action: 'register-push-device', token, platform: Capacitor.getPlatform(), appId: 'com.motman.game',
  })
}

export async function syncStoredPushDevice(): Promise<void> {
  if (!isNativeRuntime()) return
  const token = localStorage.getItem(TOKEN_STORAGE_KEY)
  if (token) await registerToken(token)
}

export async function detachStoredPushDevice(): Promise<void> {
  if (!isNativeRuntime()) return
  const token = localStorage.getItem(TOKEN_STORAGE_KEY)
  if (!token) return
  await invokeSupabaseFunction('account-api', { action: 'unregister-push-device', token }).catch(() => undefined)
}

export function initializeNativePushNotifications(): Promise<void> {
  if (initialization) return initialization
  initialization = (async () => {
    if (!isNativeRuntime()) return
    const { PushNotifications } = await import('@capacitor/push-notifications')

    await PushNotifications.addListener('registration', token => {
      void registerToken(token.value).catch(error => console.error('Enregistrement push impossible', error))
    })
    await PushNotifications.addListener('registrationError', error => {
      console.error('Inscription native aux notifications impossible', error.error)
    })
    await PushNotifications.addListener('pushNotificationActionPerformed', action => {
      const route = pushNotificationRoute(action.notification.data)
      if (!route) return
      history.replaceState(null, '', route)
      location.reload()
    })

    if (Capacitor.getPlatform() === 'android') {
      await PushNotifications.createChannel({
        id: 'motman_turns', name: 'Tours et invitations',
        description: 'Prévient lorsqu’un duel MotMan demande ton attention.',
        importance: 4, visibility: 1, vibration: true, lights: true, lightColor: '#0B5A49',
      })
    }

    let permission = await PushNotifications.checkPermissions()
    if (permission.receive === 'prompt' || permission.receive === 'prompt-with-rationale') {
      permission = await PushNotifications.requestPermissions()
    }
    if (permission.receive === 'granted') await PushNotifications.register()

    // Le tiroir se vide à l'ouverture, puis à chaque retour au premier plan :
    // c'est le moment exact où les notifications deviennent inutiles.
    await clearDeliveredPushNotifications()
    const { App } = await import('@capacitor/app')
    await App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) void clearDeliveredPushNotifications()
    })
  })()
  return initialization
}
