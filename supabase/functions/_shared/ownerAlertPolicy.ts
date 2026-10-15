// ─────────────────────────────────────────────────────────────────────────────
// « QUELQU'UN VIENT D'OUVRIR MOTMAN » — L'ALERTE D'ARRIVÉE, POUR LUI SEUL.
//
// Demandée le 23/09/2026 : « est-ce que mon compte admin peut me notifier quand
// y a quelqu'un qui se co à MotMan ? »
//
// IL N'EXISTE AUCUN ÉVÉNEMENT DE CONNEXION. Une appli ouverte tape la route
// `presence` toutes les 25 secondes ; « hors ligne » ne s'écrit nulle part, il
// se DÉDUIT d'un battement qui manque. Une arrivée est donc un battement qui
// arrive APRÈS UN TROU, et c'est la taille du trou qui décide de tout.
//
// LE SEUIL EST CELUI DU JEU, PAS UN NOMBRE INVENTÉ. Une arrivée, c'est un
// joueur qui repasse de « hors ligne » à « en ligne » — la bascule que voient
// déjà ses amis sur leur pastille, à 75 secondes sans battement.
//
// Une première version exigeait une heure d'absence, plus un plafond d'une
// alerte par joueur et par jour. Le propriétaire a tranché l'inverse le jour
// même : « je m'en fous du plafond, même s'il se co 15 fois je veux le savoir,
// donc fais vibrer. » Le plafond a sauté, et le trou d'une heure avec : quinze
// ouvertures dans une journée sont rarement espacées d'une heure, le garder
// aurait silencieusement vidé sa demande de son sens.
//
// Reste UN garde-fou, réglé ici et nulle part ailleurs : le silence de minuit
// à 10 h. La base ne connaît aucun seuil, elle les reçoit en paramètres — une
// règle écrite deux fois finit par diverger, c'est le motif de bogue le plus
// coûteux du projet.
//
// CE QUE ÇA COÛTE, ASSUMÉ : un téléphone verrouillé deux minutes puis rouvert
// est une arrivée. C'est le prix de « je veux le savoir à chaque fois ».
//
// LE PSEUDO, DEPUIS LE 15/10/2026. La première version ne nommait personne
// (choix du propriétaire le 23/09 : une notification se lit sur un écran
// verrouillé). Il est revenu dessus : « mets le pseudo de celui qui se
// connecte, que je sache si c'est quelqu'un qui a un souci ou si c'est des
// personnes différentes ». Cinq arrivées du même joueur en dix minutes, c'est
// une connexion qui lâche ; cinq pseudos différents, c'est du monde.
// ─────────────────────────────────────────────────────────────────────────────

import type { PushMessage } from './pushNotifications.ts'
import { PRESENCE_ONLINE_TTL_MS } from '../../../src/presencePolicy.ts'
import { dansLaPlage } from './parisTime.ts'

/**
 * Durée d'absence à partir de laquelle un battement est une arrivée : celle qui
 * fait déjà passer un joueur « hors ligne » aux yeux de ses amis. Importée, pas
 * recopiée — les deux doivent bouger ensemble.
 */
export const ARRIVEE_APRES_MS = PRESENCE_ONLINE_TTL_MS

/** Silence de minuit à 10 h, heure de Paris (propriétaire, 23/09/2026). */
export const SILENCE_DEBUT_HEURE = 0
export const SILENCE_FIN_HEURE = 10

export function dansLeSilence(now: number): boolean {
  return dansLaPlage(now, SILENCE_DEBUT_HEURE, SILENCE_FIN_HEURE)
}

/**
 * Le texte de la notification, avec le pseudo de celui qui arrive.
 *
 * UNE LIGNE PAR ARRIVÉE dans le tiroir : l'étiquette (`tag`) change à chaque
 * fois. Avec une étiquette commune, chaque arrivée remplaçait la précédente, et
 * « le même joueur cinq fois » ne se distinguait plus de « cinq joueurs » —
 * exactement ce que le propriétaire veut lire. `instant` ne sert qu'à ça.
 *
 * Le pseudo reste dans le titre et le texte, jamais dans `data`.
 */
export function messageArrivee(pseudo: string, enLigne: number, instant: number): PushMessage {
  const qui = pseudo.trim() || 'Quelqu’un'
  return {
    title: `${qui} arrive`,
    body: enLigne > 1
      ? `${qui} vient d’ouvrir MotMan · ${enLigne} joueurs en ligne.`
      : `${qui} vient d’ouvrir MotMan.`,
    data: { type: 'player_arrival' },
    tag: `arrivee-${instant}`,
  }
}

// L'alerte « une partie classée cherche quelqu'un » (25/09/2026) a été retirée
// le 15/10/2026, à la demande du propriétaire : « enlève les notifs classé pour
// moi ». Le fantôme (match-api/ghost.ts) donne déjà la partie à sa place.
