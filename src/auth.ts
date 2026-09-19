import { savePlayerCosmetics, type CosmeticKind, type CosmeticReward, type PlayerCosmetics } from './cosmetics'
import {
  loadDailyChallengeState, reconcileServerDailyStreak, saveDailyChallengeState, type ServerDailyStreak,
} from './dailyChallenge'
import { loadPlayerIdentity, savePlayerIdentity, type GuestIdentity } from './playerIdentity'
import { savePlayerProgress, type PlayerProgress } from './playerProgress'
import { saveQuestBoard, type QuestBoard } from './questBoardState'
import { supabase, supabaseConfigured } from './supabaseClient'
import { invokeSupabaseFunction } from './supabaseFunctions'
import { isNativeRuntime, NATIVE_AUTH_REDIRECT, openNativeAuthentication } from './nativeRuntime'
import { getAnonymousCaptchaToken } from './turnstile'
import { parseGoogleAuthIssue, takeRememberedGoogleAuthIssue, type GoogleAuthIssue } from './googleAuthCallback'
import { messageAuth } from './authErrors'

const recoveryListeners = new Set<() => void>()
let passwordRecoveryPending = false
let googleAuthIssuePending: GoogleAuthIssue | null = null
const localTestServer = import.meta.env.VITE_MOTMAN_LOCAL_TEST_SERVER === 'true'

if (supabaseConfigured) {
  supabase.auth.onAuthStateChange(event => {
    if (event !== 'PASSWORD_RECOVERY') return
    passwordRecoveryPending = true
    recoveryListeners.forEach(listener => listener())
  })
}

/** Ce qu'une récupération de quête a réellement crédité, dit par le serveur. */
export type ClaimedQuestReward = {
  applied: boolean
  plumes: number
  xp: number
  freezes: number
  feathers: number
  streakFreezes: number
}

export type AuthResponse = {
  identity: GuestIdentity
  progress?: PlayerProgress
  cosmetics?: PlayerCosmetics
  /** Série du défi du jour recalculée par le serveur depuis les jours joués (`daily_plays`). */
  daily?: ServerDailyStreak
  /** Quêtes du jour et de la semaine, telles que le serveur les compte (src/quests.ts). */
  quests?: QuestBoard
  emailConfirmationRequired?: boolean
}

/** Le joueur dont les données sont sur l'appareil, sans en créer un s'il manque. */
function joueurSurLAppareil(): string | null {
  try {
    const stocke = JSON.parse(localStorage.getItem('motman-player-v1') ?? 'null') as { playerId?: unknown } | null
    return typeof stocke?.playerId === 'string' ? stocke.playerId : null
  } catch {
    return null
  }
}

function store(payload: AuthResponse): AuthResponse {
  // UN AUTRE COMPTE SUR CET APPAREIL (connexion à un compte existant, par
  // e-mail ou Google) : l'état du défi du jour et le texte de partage sont
  // ceux du joueur précédent. Sans ce ménage, le nouveau compte héritait de sa
  // série (le rapprochement garde le maximum), de son « réussi » ou de son
  // « fermé » du jour — plus de bouton Jouer — et de son partage (19/09/2026).
  // Le passage d'une identité locale `guest_…` à l'identifiant du serveur, au
  // tout premier démarrage, ne trouve rien à effacer.
  const precedent = joueurSurLAppareil()
  if (precedent && !precedent.startsWith('guest_') && precedent !== payload.identity.playerId) {
    try {
      localStorage.removeItem('motman-daily-v1')
      localStorage.removeItem('motman-daily-share-v1')
    } catch { /* Stockage indisponible : rien à hériter non plus. */ }
  }
  if (payload.quests) saveQuestBoard(payload.quests)
  if (payload.progress) savePlayerProgress(payload.progress)
  if (payload.cosmetics) savePlayerCosmetics(payload.cosmetics)
  // La série du défi du jour n'est PAS écrasée comme le portefeuille : on garde
  // la plus longue des deux. Le client est normalement en avance d'une victoire
  // (il vient de gagner, le compte n'a pas encore été rechargé), et écraser
  // ferait clignoter la série à chaque partie. Voir reconcileServerDailyStreak.
  if (payload.daily) {
    const local = loadDailyChallengeState()
    const merged = reconcileServerDailyStreak(local, payload.daily)
    if (merged !== local) saveDailyChallengeState(merged)
  }
  savePlayerIdentity(payload.identity)
  return payload
}

function clearPlayerDataFromDevice(): void {
  // La série du défi du jour et son partage DOIVENT partir avec le compte : sur
  // un appareil partagé, le joueur suivant en hériterait — le rapprochement avec
  // le serveur ne garde que le maximum. Les anciennes clés du Solo et des avis
  // de fin de partie ne sont plus écrites, mais peuvent traîner sur un appareil.
  for (const cle of ['motman-player-v1', 'motman-progress-v1', 'motman-cosmetics-v1', 'motman-daily-v1', 'motman-daily-share-v1', 'motman-recent-solo-grids-v4', 'entrelignes-feedback']) {
    try { localStorage.removeItem(cle) } catch { /* Stockage indisponible : rien à effacer. */ }
  }
}

async function accountAction(action: string, body: Record<string, unknown> = {}): Promise<AuthResponse> {
  // Serveur de test local (npm run dev avec VITE_MOTMAN_LOCAL_TEST_SERVER) :
  // les actions de compte passent par ses routes plutôt que par Supabase, qui
  // n'y est pas configuré. Sans ça, « Récupérer » une quête ne pouvait pas être
  // éprouvé hors production.
  if (localTestServer) {
    const response = await fetch(`/api/auth/${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const payload = await response.json().catch(() => ({})) as AuthResponse & { error?: string }
    if (!response.ok) throw new Error(payload.error ?? 'Action impossible sur le serveur de test.')
    return store(payload)
  }
  return store(await invokeSupabaseFunction<AuthResponse>('account-api', { action, ...body }))
}

export async function bootstrapPlayerSession(): Promise<GuestIdentity> {
  googleAuthIssuePending = parseGoogleAuthIssue(location.search, location.hash)
    ?? takeRememberedGoogleAuthIssue(sessionStorage)
  if (googleAuthIssuePending) {
    history.replaceState(null, '', `${location.pathname}#profil`)
  }
  const legacyIdentity = loadPlayerIdentity()
  if (localTestServer) {
    const response = await fetch('/api/auth/bootstrap', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: legacyIdentity }),
    })
    const payload = await response.json() as AuthResponse & { error?: string }
    if (!response.ok) throw new Error(payload.error ?? 'Session locale de test indisponible.')
    return store(payload).identity
  }
  if (!supabaseConfigured) throw new Error('MotMan ne trouve pas sa configuration Supabase.')
  let { data: sessionData } = await supabase.auth.getSession()
  if (!sessionData.session) {
    const captchaToken = await getAnonymousCaptchaToken()
    const { data, error } = await supabase.auth.signInAnonymously(captchaToken ? { options: { captchaToken } } : undefined)
    if (error || !data.session) throw new Error(messageAuth(error, 'Création de la session MotMan impossible. Réessayez.'))
    sessionData = { session: data.session }
  }
  const response = await accountAction('bootstrap', { identity: legacyIdentity })
  return response.identity
}

export function refreshPlayerAccount(): Promise<AuthResponse> {
  return accountAction('state')
}

export function currentGoogleAuthIssue(): GoogleAuthIssue | null {
  return googleAuthIssuePending
}

export function clearGoogleAuthIssue(): void {
  googleAuthIssuePending = null
}

export function subscribePasswordRecovery(listener: () => void): () => void {
  recoveryListeners.add(listener)
  if (passwordRecoveryPending) queueMicrotask(listener)
  return () => recoveryListeners.delete(listener)
}

export function consumePasswordRecovery(): boolean {
  const pending = passwordRecoveryPending
  passwordRecoveryPending = false
  return pending
}

export async function createPlayerAccount(email: string): Promise<AuthResponse> {
  const emailRedirectTo = isNativeRuntime()
    ? NATIVE_AUTH_REDIRECT
    : `${location.origin}${location.pathname}#profil`
  const { error } = await supabase.auth.updateUser({ email: email.trim() }, { emailRedirectTo })
  if (error) throw new Error(messageAuth(error, 'Création du compte impossible. Réessayez.'))
  const state = await accountAction('state')
  return { ...state, emailConfirmationRequired: true }
}

export async function finishPlayerAccount(password: string): Promise<AuthResponse> {
  const { error } = await supabase.auth.updateUser({ password })
  if (error) throw new Error(messageAuth(error, 'Mot de passe non enregistré. Réessayez.'))
  return accountAction('state')
}

export async function loginPlayerAccount(email: string, password: string): Promise<AuthResponse> {
  if (isNativeRuntime()) {
    await import('./nativePushNotifications').then(module => module.detachStoredPushDevice()).catch(() => undefined)
  }
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
  if (error) {
    if (isNativeRuntime()) {
      void import('./nativePushNotifications').then(module => module.syncStoredPushDevice()).catch(() => undefined)
    }
    // Seuls de mauvais identifiants disent « incorrect » : un réseau coupé ou
    // une limite de tentatives ont leur propre message.
    throw new Error(messageAuth(error, 'E-mail ou mot de passe incorrect.'))
  }
  const account = await accountAction('state')
  if (isNativeRuntime()) {
    void import('./nativePushNotifications').then(module => module.syncStoredPushDevice()).catch(() => undefined)
  }
  return account
}

export async function authenticateWithGoogle(mode: 'link' | 'sign-in' = 'link'): Promise<void> {
  if (!supabaseConfigured) {
    throw new Error('Connexion Google indisponible. Redémarrez MotMan puis réessayez.')
  }
  const native = isNativeRuntime()
  const redirectTo = native ? NATIVE_AUTH_REDIRECT : `${location.origin}${location.pathname}#profil`
  const options = { redirectTo, skipBrowserRedirect: native }
  const { data: { user } } = await supabase.auth.getUser()
  const shouldLink = mode === 'link' && user?.is_anonymous === true
  const { data, error } = shouldLink
    ? await supabase.auth.linkIdentity({ provider: 'google', options })
    : await supabase.auth.signInWithOAuth({ provider: 'google', options })
  if (error) throw new Error(messageAuth(error, 'Connexion Google impossible. Réessayez.'))
  if (data?.url) {
    if (native) await openNativeAuthentication(data.url)
    else location.assign(data.url)
  }
}

export async function recoverPlayerAccount(email: string): Promise<void> {
  const redirectTo = isNativeRuntime()
    ? NATIVE_AUTH_REDIRECT
    : `${location.origin}${location.pathname}#profil`
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo })
  if (error) throw new Error(messageAuth(error, 'Envoi du lien impossible. Réessayez.'))
}

export async function logoutPlayerAccount(): Promise<GuestIdentity> {
  if (isNativeRuntime()) {
    await import('./nativePushNotifications').then(module => module.detachStoredPushDevice()).catch(() => undefined)
  }
  // CET appareil seulement (`local`) : la portée par défaut déconnectait aussi
  // le compte sur tous les autres téléphones et navigateurs. Et un échec (réseau)
  // garde la session : on s'arrête là, au lieu d'effacer l'appareil puis de
  // recharger le même compte en annonçant « Déconnecté » (19/09/2026).
  const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' })
  if (signOutError) {
    if (isNativeRuntime()) void import('./nativePushNotifications').then(module => module.syncStoredPushDevice()).catch(() => undefined)
    throw new Error(messageAuth(signOutError, 'Déconnexion impossible. Vérifiez votre connexion, puis réessayez.'))
  }
  clearPlayerDataFromDevice()
  const identity = await bootstrapPlayerSession()
  if (isNativeRuntime()) {
    void import('./nativePushNotifications').then(module => module.syncStoredPushDevice()).catch(() => undefined)
  }
  return identity
}

export async function deletePlayerAccount(confirmation: string): Promise<AuthResponse> {
  if (confirmation !== 'SUPPRIMER') throw new Error('Écrivez SUPPRIMER pour confirmer.')

  if (isNativeRuntime()) {
    await import('./nativePushNotifications').then(module => module.detachStoredPushDevice()).catch(() => undefined)
  }

  if (localTestServer) {
    const response = await fetch('/api/auth/delete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmation }),
    })
    const payload = await response.json().catch(() => ({})) as { error?: string }
    if (!response.ok) throw new Error(payload.error ?? 'Suppression du compte impossible.')
  } else {
    await invokeSupabaseFunction<{ deleted: true }>('account-api', { action: 'delete-account', confirmation })
    // The server has already revoked every refresh token and deleted the user.
    // This local sign-out only clears Supabase's browser/native storage.
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
  }

  clearPlayerDataFromDevice()
  const identity = await bootstrapPlayerSession()
  if (isNativeRuntime()) {
    void import('./nativePushNotifications').then(module => module.syncStoredPushDevice()).catch(() => undefined)
  }
  return { identity }
}

export function updateServerProfile(displayName: string, avatarId: string, frameId: string, animationId: string, titleId: string | null): Promise<AuthResponse> {
  return accountAction('update-profile', { displayName, avatarId, frameId, animationId, titleId })
}

export function equipServerCosmetic(kind: CosmeticKind, id: string): Promise<AuthResponse> {
  return accountAction('equip-cosmetic', { kind, id })
}

export function purchaseServerCosmetic(kind: CosmeticKind, id: string, idempotencyKey = crypto.randomUUID()): Promise<AuthResponse> {
  return accountAction('purchase-cosmetic', { kind, id, idempotencyKey })
}

/**
 * Récupère une quête finie. Le montant n'est PAS envoyé : le serveur relit la
 * progression et le barème (src/quests.ts), paie une seule fois, et rend ce
 * qu'il a réellement crédité.
 */
export function claimQuest(questId: string, scope: 'day' | 'week'): Promise<AuthResponse & { questReward?: ClaimedQuestReward }> {
  return accountAction('claim-quest', { questId, scope }) as Promise<AuthResponse & { questReward?: ClaimedQuestReward }>
}

/** Achète un gel de série : 500 plumes, 3 en poche au plus (server_buy_streak_freeze). */
export function buyServerStreakFreeze(idempotencyKey = crypto.randomUUID()): Promise<AuthResponse> {
  return accountAction('buy-streak-freeze', { idempotencyKey })
}

export async function openServerBasket(basketId: string, idempotencyKey = crypto.randomUUID()): Promise<AuthResponse & { reward: CosmeticReward }> {
  return accountAction('open-basket', { basketId, idempotencyKey }) as Promise<AuthResponse & { reward: CosmeticReward }>
}
