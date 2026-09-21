export type SocialActionRoute =
  | 'state'
  | 'search'
  | 'presence'
  | 'request'
  | 'respond'
  | 'moderation'
  /** Les avertissements reçus par le joueur lui-même : lecture, puis « lu ». */
  | 'warnings'
  | 'target'
  | 'unknown'

const TARGET_ACTIONS = new Set(['cancel', 'remove', 'block', 'unblock', 'report'])

export function socialActionRoute(action: string): SocialActionRoute {
  if (action === 'state') return 'state'
  if (action === 'search') return 'search'
  if (action === 'presence') return 'presence'
  if (action === 'request') return 'request'
  if (action === 'respond') return 'respond'
  if (action === 'moderation-list' || action === 'moderation-resolve') return 'moderation'
  if (action === 'warnings-list' || action === 'warnings-ack') return 'warnings'
  if (TARGET_ACTIONS.has(action)) return 'target'
  return 'unknown'
}
