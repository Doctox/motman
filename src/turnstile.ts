type TurnstileWidget = {
  render: (container: HTMLElement, options: Record<string, unknown>) => string
  remove: (widgetId: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileWidget
  }
}

const scriptId = 'motman-turnstile-script'
const scriptUrl = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
// Turnstile site keys are public. Keeping the production key as a fallback makes
// GitHub Pages and native builds safe even when no build variable is injected.
const productionSiteKey = '0x4AAAAAAD559OXTbbx2uJOM'
let scriptPromise: Promise<TurnstileWidget> | null = null

function configuredSiteKey(): string | null {
  const value = String(import.meta.env.VITE_TURNSTILE_SITE_KEY || productionSiteKey).trim()
  return value || null
}

export function isTurnstileConfigured(): boolean {
  return configuredSiteKey() !== null
}

function loadTurnstile(): Promise<TurnstileWidget> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  if (scriptPromise) return scriptPromise
  const pending = new Promise<TurnstileWidget>((resolve, reject) => {
    const existing = document.getElementById(scriptId) as HTMLScriptElement | null
    const script = existing ?? document.createElement('script')
    const finish = () => window.turnstile
      ? resolve(window.turnstile)
      : reject(new Error('La vérification de sécurité ne s’est pas chargée.'))
    script.addEventListener('load', finish, { once: true })
    script.addEventListener('error', () => reject(new Error('La vérification de sécurité est indisponible.')), { once: true })
    if (!existing) {
      script.id = scriptId
      script.src = scriptUrl
      script.async = true
      script.defer = true
      document.head.append(script)
    }
  })
  const loading = pending.catch(error => {
    scriptPromise = null
    throw error
  })
  scriptPromise = loading
  return loading
}

/**
 * UN JETON ANTI-ROBOT POUR TOUTE ENTRÉE DANS LE COMPTE (21/09/2026).
 *
 * Cette fonction ne servait qu'à la création de profil invité, et son nom le
 * disait. La connexion par e-mail, elle, n'en demandait AUCUN : Supabase la
 * refusait donc systématiquement — « captcha protection: request disallowed
 * (no captcha_token found) » — et le joueur lisait « La vérification
 * anti-robot a échoué », sans que rien n'ait jamais été vérifié. Personne ne
 * pouvait se reconnecter par mot de passe. Relevé par une testeuse le
 * 21/09/2026 ; invisible jusque-là parce que tout le monde passait par Google.
 *
 * `action` n'est qu'une étiquette pour les statistiques Cloudflare : elle ne
 * change pas la validité du jeton, mais elle dit quel chemin a été emprunté.
 */
export async function getCaptchaToken(action = 'anonymous-sign-in'): Promise<string | null> {
  const sitekey = configuredSiteKey()
  if (!sitekey) return null

  const turnstile = await loadTurnstile()
  const host = document.createElement('div')
  host.className = 'turnstile-guard'
  host.setAttribute('aria-label', 'Vérification de sécurité')
  document.body.append(host)

  return new Promise<string>((resolve, reject) => {
    let widgetId = ''
    let settled = false
    const timeout = window.setTimeout(() => finish(new Error('La vérification de sécurité a expiré. Réessaie.')), 30_000)
    const cleanup = () => {
      window.clearTimeout(timeout)
      if (widgetId) {
        try { turnstile.remove(widgetId) } catch { /* Le widget est peut-être déjà retiré. */ }
      }
      host.remove()
    }
    const finish = (result: string | Error) => {
      if (settled) return
      settled = true
      cleanup()
      if (result instanceof Error) reject(result)
      else resolve(result)
    }

    try {
      widgetId = turnstile.render(host, {
        sitekey,
        action,
        theme: 'auto',
        size: 'flexible',
        appearance: 'interaction-only',
        callback: (token: string) => finish(token),
        'error-callback': () => finish(new Error('La vérification de sécurité a échoué. Réessaie.')),
        'timeout-callback': () => finish(new Error('La vérification de sécurité a expiré. Réessaie.')),
      })
    } catch (error) {
      finish(error instanceof Error ? error : new Error('La vérification de sécurité est indisponible.'))
    }
  })
}
