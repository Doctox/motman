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
// AUCUN PSEUDO, décidé par le propriétaire le même jour. Le pouls du jeu a été
// construit exprès avec des nombres et jamais des noms ; cette notification
// suit la même règle, et pour une raison de plus : elle s'affiche sur un écran
// verrouillé, parfois devant quelqu'un d'autre.
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
 * Le texte de la notification. Un seul fil (`tag`) : trois arrivées font trois
 * vibrations, mais une seule ligne dans le tiroir, mise à jour — sans pseudo,
 * trois lignes identiques empilées n’apprendraient rien de plus.
 */
export function messageArrivee(enLigne: number): PushMessage {
  return {
    title: 'Un joueur arrive',
    body: enLigne > 1
      ? `Quelqu’un vient d’ouvrir MotMan · ${enLigne} joueurs en ligne.`
      : 'Quelqu’un vient d’ouvrir MotMan.',
    data: { type: 'player_arrival' },
    tag: 'arrivee',
  }
}
