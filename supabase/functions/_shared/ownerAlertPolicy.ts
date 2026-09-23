// ─────────────────────────────────────────────────────────────────────────────
// « QUELQU'UN VIENT D'OUVRIR MOTMAN » — L'ALERTE D'ARRIVÉE, POUR LUI SEUL.
//
// Demandée le 23/09/2026 : « est-ce que mon compte admin peut me notifier quand
// y a quelqu'un qui se co à MotMan ? »
//
// IL N'EXISTE AUCUN ÉVÉNEMENT DE CONNEXION. Une appli ouverte tape la route
// `presence` toutes les 25 secondes ; « hors ligne » ne s'écrit nulle part, il
// se DÉDUIT d'un battement qui manque depuis 75 secondes. Une arrivée est donc
// un battement qui arrive APRÈS UN TROU — et c'est la taille du trou qui décide
// de tout : au seuil de 75 secondes, un téléphone verrouillé deux minutes puis
// rouvert déclencherait une notification.
//
// Les trois garde-fous, réglés ici et nulle part ailleurs. La base ne les
// connaît pas : `server_presence_touch` reçoit le seuil en paramètre, pour que
// la règle n'existe pas en double (c'est le motif de bogue le plus coûteux du
// projet).
//   1. le trou doit durer au moins une heure ;
//   2. une seule alerte par joueur et par journée de Paris ;
//   3. silence de minuit à 10 h, choisi par le propriétaire.
//
// AUCUN PSEUDO, décidé par le propriétaire le même jour. Le pouls du jeu a été
// construit exprès avec des nombres et jamais des noms ; cette notification
// suit la même règle, et pour une raison de plus : elle s'affiche sur un écran
// verrouillé, parfois devant quelqu'un d'autre.
// ─────────────────────────────────────────────────────────────────────────────

import type { PushMessage } from './pushNotifications.ts'
import { dansLaPlage } from './parisTime.ts'

/** Durée d'absence en dessous de laquelle un retour n'est pas une arrivée. */
export const ARRIVEE_APRES_MS = 3_600_000

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
