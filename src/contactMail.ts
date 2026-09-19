// ─────────────────────────────────────────────────────────────────────────────
// NOUS ÉCRIRE — le formulaire de l'onglet « Contact » (LegalPanel.tsx).
//
// Rien ne part du jeu : le formulaire PRÉPARE un e-mail (lien `mailto:`) que la
// messagerie du joueur ouvre, prêt à envoyer. Pas de table, pas de fonction
// serveur, et la réponse arrive dans la boîte du joueur comme n'importe quel
// e-mail. Demandé par le propriétaire le 19/09/2026 : pour les bugs, mais aussi
// les suggestions, les questions et les demandes commerciales.
//
// Une capture ou un PDF ne voyage pas dans un `mailto:` : le joueur l'ajoute
// lui-même dans l'e-mail qui s'ouvre, avec le trombone de sa messagerie. Un
// stockage chez nous a été écarté par le propriétaire le 19/09/2026.
//
// Pour un bug, le message emporte ce qu'il faut pour le retrouver : la version
// exacte (numéro de construction et code du commit), l'appareil, la taille de
// l'écran et le code du joueur. Le joueur le voit dans son e-mail avant de
// l'envoyer.
// ─────────────────────────────────────────────────────────────────────────────

export const CONTACT_EMAIL = 'contact@doctox.fr'

export type ContactSujet = 'bug' | 'suggestion' | 'demande' | 'pro'

export const CONTACT_SUJETS: ReadonlyArray<{ id: ContactSujet; libelle: string; objet: string; invite: string }> = [
  { id: 'bug', libelle: 'Un bug', objet: 'Bug', invite: 'Ce qui s’est passé, et ce que vous faisiez juste avant : écran, mode de jeu, heure…' },
  { id: 'suggestion', libelle: 'Une idée', objet: 'Suggestion', invite: 'Votre idée pour MotMan…' },
  { id: 'demande', libelle: 'Une question', objet: 'Question', invite: 'Votre question ou votre demande…' },
  { id: 'pro', libelle: 'Demande pro', objet: 'Demande commerciale', invite: 'Présentez-vous et votre projet : partenariat, grilles sur mesure, presse…' },
]

export type ContactTechnique = {
  /** « #123 · code abc1234 » */
  version: string
  support: 'appli' | 'site'
  appareil: string
  ecran: string
  joueur: { nom: string; code?: string } | null
}

const NAVIGATEURS: ReadonlyArray<[RegExp, string]> = [
  // Edge se déclare aussi « Chrome » : il passe avant.
  [/Edg\/(\d+)/, 'Edge'], [/Firefox\/(\d+)/, 'Firefox'], [/Chrome\/(\d+)/, 'Chrome'], [/Version\/([\d.]+).*Safari/, 'Safari'],
]

/**
 * L'appareil en clair, tiré de l'agent utilisateur : « Android 14 · Pixel 7 ·
 * Chrome 128 ». Ce qu'on ne reconnaît pas est rendu tel quel, plutôt que perdu.
 */
export function decrireAppareil(agent: string): string {
  const navigateur = NAVIGATEURS
    .map(([motif, nom]) => { const trouve = motif.exec(agent); return trouve ? `${nom} ${trouve[1]}` : null })
    .find(Boolean) ?? null
  const android = /Android ([\d.]+)(?:; ([^;)]+))?/.exec(agent)
  const apple = /(iPhone|iPad)[^)]*? OS ([\d_]+)/.exec(agent)
  const systeme = android ? ['Android ' + android[1], android[2]?.trim() && android[2].trim() !== 'K' ? android[2].trim() : null]
    : apple ? [`${apple[1]} · iOS ${apple[2].replace(/_/g, '.')}`]
      : /Windows NT/.test(agent) ? ['Windows']
        : /Mac OS X/.test(agent) ? ['Mac']
          : /Linux/.test(agent) ? ['Linux']
            : []
  const morceaux = [...systeme, navigateur].filter((morceau): morceau is string => Boolean(morceau))
  return morceaux.length ? morceaux.join(' · ') : agent
}

/** Joindre la fiche technique ? Pour un bug, toujours ; pour une demande commerciale, jamais. */
export function joindreTechnique(sujet: ContactSujet): boolean {
  return sujet === 'bug'
}

/** Le joueur, sauf pour une demande commerciale, qui n'a rien à voir avec son compte. */
export function joindreJoueur(sujet: ContactSujet): boolean {
  return sujet !== 'pro'
}

export function contactObjet(sujet: ContactSujet): string {
  return `MotMan · ${CONTACT_SUJETS.find(entree => entree.id === sujet)?.objet ?? 'Message'}`
}

export function contactCorps(sujet: ContactSujet, message: string, technique: ContactTechnique): string {
  const lignes = [message.trim()]
  const pied: string[] = []
  if (joindreJoueur(sujet) && technique.joueur) {
    pied.push(`Joueur : ${technique.joueur.nom}${technique.joueur.code ? ` (code ${technique.joueur.code})` : ''}`)
  }
  if (joindreTechnique(sujet)) {
    pied.push(
      `Version : ${technique.version} · ${technique.support === 'appli' ? 'appli installée' : 'site'}`,
      `Appareil : ${technique.appareil}`,
      `Écran : ${technique.ecran}`,
    )
  }
  if (pied.length) lignes.push('', '—', ...pied)
  return lignes.join('\r\n')
}

/**
 * Le lien qui ouvre la messagerie. `encodeURIComponent` et pas
 * `URLSearchParams` : ce dernier code l'espace en « + », que les messageries
 * laissent tel quel dans l'objet d'un `mailto:` (RFC 6068).
 */
export function contactMailto(sujet: ContactSujet, message: string, technique: ContactTechnique): string {
  const objet = encodeURIComponent(contactObjet(sujet))
  const corps = encodeURIComponent(contactCorps(sujet, message, technique))
  return `mailto:${CONTACT_EMAIL}?subject=${objet}&body=${corps}`
}
