export type ProtectedApi = 'account' | 'social' | 'match'

export type RateLimitPolicy = {
  bucket: string
  maxRequests: number
  windowSeconds: number
}

const globalLimits: Record<ProtectedApi, { guest: number; account: number }> = {
  account: { guest: 90, account: 180 },
  social: { guest: 90, account: 180 },
  // Realtime wakes are preferred, but a visible match still keeps a slow
  // fallback poll. This ceiling blocks floods without interrupting play.
  match: { guest: 180, account: 300 },
}

export function globalRateLimit(api: ProtectedApi, isAnonymous: boolean): RateLimitPolicy {
  const limits = globalLimits[api]
  return {
    bucket: `${api}:all`,
    maxRequests: isAnonymous ? limits.guest : limits.account,
    windowSeconds: 60,
  }
}

export function actionRateLimits(
  api: ProtectedApi,
  action: string,
  isAnonymous: boolean,
  targetId?: string,
): RateLimitPolicy[] {
  if (api === 'social' && action === 'request') {
    return [{ bucket: 'social:friend-request', maxRequests: isAnonymous ? 8 : 20, windowSeconds: 3600 }]
  }
  if (api === 'social' && action === 'search') {
    return [{ bucket: 'social:friend-search', maxRequests: isAnonymous ? 20 : 40, windowSeconds: 60 }]
  }
  if (api === 'social' && action === 'report') {
    return [{ bucket: 'social:report', maxRequests: 5, windowSeconds: 3600 }]
  }
  if (api === 'match' && action === 'search') {
    return [{ bucket: 'match:search', maxRequests: isAnonymous ? 12 : 24, windowSeconds: 300 }]
  }
  if (api === 'match' && action === 'ranked-search') {
    return [{ bucket: 'match:ranked-search', maxRequests: isAnonymous ? 8 : 20, windowSeconds: 300 }]
  }
  if (api === 'match' && (action === 'ranked-ready-response' || action === 'ranked-cancel')) {
    return [{ bucket: `match:${action}`, maxRequests: 12, windowSeconds: 60 }]
  }
  if (api === 'match' && action === 'ranked-leaderboard') {
    return [{ bucket: 'match:ranked-leaderboard', maxRequests: 30, windowSeconds: 60 }]
  }
  if (api === 'match' && action === 'solo') {
    return [{ bucket: 'match:solo', maxRequests: isAnonymous ? 20 : 40, windowSeconds: 600 }]
  }
  // Le défi du jour est volontairement rejouable jusqu'à minuit : le plafond ne
  // sert qu'à empêcher la création en boucle de parties, pas à limiter les
  // tentatives d'un joueur normal. Même ordre de grandeur que le solo.
  if (api === 'match' && action === 'daily') {
    return [{ bucket: 'match:daily', maxRequests: isAnonymous ? 20 : 40, windowSeconds: 600 }]
  }
  if (api === 'match' && action === 'create') {
    const policies: RateLimitPolicy[] = [
      { bucket: 'match:invite', maxRequests: isAnonymous ? 12 : 30, windowSeconds: 1800 },
    ]
    if (targetId && /^[a-f0-9-]{36}$/i.test(targetId)) {
      policies.push({ bucket: `match:invite-target:${targetId.toLowerCase()}`, maxRequests: 6, windowSeconds: 600 })
    }
    return policies
  }
  // Relecture d'une partie terminée : lecture seule, mais elle va chercher une
  // charpente de grille. Généreux — on relit volontiers plusieurs parties de
  // suite — sans laisser aspirer le catalogue.
  if (api === 'match' && action === 'history-grid') {
    return [{ bucket: 'match:history-grid', maxRequests: 40, windowSeconds: 300 }]
  }
  // Classement du jour : lecture seule, mais le client peut le rafraîchir en
  // consultant. Sans entrée ici, l'action tomberait dans le `return []` final
  // et n'aurait AUCUNE limite.
  if (api === 'match' && action === 'player-stats') {
    return [{ bucket: 'match:player-stats', maxRequests: isAnonymous ? 20 : 60, windowSeconds: 300 }]
  }
  if (api === 'match' && action === 'daily-leaderboard') {
    return [{ bucket: 'match:daily-leaderboard', maxRequests: isAnonymous ? 20 : 60, windowSeconds: 300 }]
  }
  if (api === 'match' && action === 'feedback') {
    return [{ bucket: 'match:feedback', maxRequests: 20, windowSeconds: 3600 }]
  }
  // Catalogue complet servi à l'atelier de fabrication. Réservé aux comptes
  // `admin`, appelé une fois au démarrage — d'où un quota serré. Sans cette
  // entrée, l'action tomberait dans le `return []` final et n'aurait AUCUNE
  // limite : la liste est la seule source, un libellé inconnu passe librement.
  if (api === 'account' && action === 'grid-catalog-snapshot') {
    return [{
      bucket: 'account:grid-catalog-snapshot',
      maxRequests: 6,
      windowSeconds: 3600,
    }]
  }
  if (api === 'account' && action === 'grid-usage-snapshot') {
    return [{
      bucket: 'account:grid-usage-snapshot',
      maxRequests: isAnonymous ? 6 : 12,
      windowSeconds: 600,
    }]
  }
  return []
}
