// ─────────────────────────────────────────────────────────────────────────────
// LES ERREURS DE CONNEXION, EN FRANÇAIS.
//
// Supabase Auth répond en anglais (« Password should be at least 6
// characters », « Email rate limit exceeded »…), et `auth.ts` relançait ces
// textes tels quels : le joueur les lisait dans le panneau Compte ou sur
// l'écran de démarrage (relevé le 19/09/2026). On traduit d'après le CODE de
// l'erreur, jamais d'après son texte, et tout ce qu'on ne reconnaît pas devient
// le message de repli, en français.
// ─────────────────────────────────────────────────────────────────────────────

type ErreurAuth = { code?: unknown; status?: unknown; name?: unknown; message?: unknown } | null | undefined

const PAR_CODE: Record<string, string> = {
  weak_password: 'Le mot de passe doit contenir au moins 6 caractères.',
  same_password: 'Choisis un mot de passe différent de l’actuel.',
  email_address_invalid: 'Cette adresse e-mail n’est pas valide.',
  email_exists: 'Cette adresse e-mail est déjà utilisée par un autre compte.',
  user_already_exists: 'Cette adresse e-mail est déjà utilisée par un autre compte.',
  identity_already_exists: 'Ce compte Google est déjà lié à un autre profil MotMan.',
  email_not_confirmed: 'Adresse e-mail pas encore confirmée : ouvre le lien reçu par e-mail.',
  invalid_credentials: 'E-mail ou mot de passe incorrect.',
  captcha_failed: 'La vérification anti-robot a échoué. Réessaie.',
  over_email_send_rate_limit: 'Trop d’e-mails envoyés. Réessaie dans quelques minutes.',
  over_request_rate_limit: 'Trop de tentatives. Réessaie dans quelques minutes.',
  over_sms_send_rate_limit: 'Trop de tentatives. Réessaie dans quelques minutes.',
  session_not_found: 'Ta session a expiré. Reconnecte-toi.',
  refresh_token_not_found: 'Ta session a expiré. Reconnecte-toi.',
  anonymous_provider_disabled: 'La création de profil invité est momentanément fermée. Réessaie plus tard.',
}

/** Le message à montrer au joueur pour une erreur de Supabase Auth. */
export function messageAuth(erreur: ErreurAuth, repli: string): string {
  const code = typeof erreur?.code === 'string' ? erreur.code : ''
  if (PAR_CODE[code]) return PAR_CODE[code]
  if (erreur?.status === 429) return PAR_CODE.over_request_rate_limit
  // Réseau coupé : supabase-js n'a jamais reçu de réponse.
  if (erreur?.name === 'AuthRetryableFetchError' || erreur?.status === 0) return 'Connexion impossible. Vérifie ton réseau, puis réessaie.'
  return repli
}
