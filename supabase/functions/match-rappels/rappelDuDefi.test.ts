// Banc d'essai du rappel du défi (02/11/2026). Le 2 novembre 2026, Paris est à
// UTC+1 : 19:00 Z = 20 h à Paris.

import { derniersDefis, heureDuRappel, messageDuRappel, rappelDu } from './rappelDuDefi.ts'

function egal<T>(recu: T, attendu: T, message: string) {
  if (recu !== attendu) throw new Error(`${message} : attendu ${attendu}, reçu ${recu}`)
}

const paris = (jour: string, heure: number) => Date.parse(`${jour}T${String(heure - 1).padStart(2, '0')}:00:00Z`)
const ouvertLe = (jour: string, heure: number) => new Date(paris(jour, heure)).toISOString()

Deno.test('le rappel part à l’heure de son dernier défi, ramenée entre 10 h et 21 h', () => {
  egal(heureDuRappel(ouvertLe('2026-11-01', 20)), 20, 'le soir')
  egal(heureDuRappel(ouvertLe('2026-11-01', 8)), 10, 'trop tôt')
  egal(heureDuRappel(ouvertLe('2026-11-01', 23)), 21, 'trop tard')
  egal(heureDuRappel(ouvertLe('2026-11-01', 1)), 10, 'en pleine nuit')
})

Deno.test('le lendemain, pas avant son heure', () => {
  const hier = { jour: '2026-11-01', ouvertLe: ouvertLe('2026-11-01', 20) }
  egal(rappelDu(hier, '2026-11-02', paris('2026-11-02', 19)), false, 'une heure avant')
  egal(rappelDu(hier, '2026-11-02', paris('2026-11-02', 20)), true, 'à son heure')
  egal(rappelDu(hier, '2026-11-02', paris('2026-11-02', 21)), true, 'encore dû plus tard dans la soirée')
})

Deno.test('rien la nuit, même en retard', () => {
  const hier = { jour: '2026-11-01', ouvertLe: ouvertLe('2026-11-01', 20) }
  egal(rappelDu(hier, '2026-11-02', paris('2026-11-02', 22)), false, 'à 22 h')
  egal(rappelDu(hier, '2026-11-02', paris('2026-11-02', 9)), false, 'à 9 h')
})

Deno.test('rien s’il a déjà joué aujourd’hui', () => {
  const ceMatin = { jour: '2026-11-02', ouvertLe: ouvertLe('2026-11-02', 10) }
  egal(rappelDu(ceMatin, '2026-11-02', paris('2026-11-02', 20)), false, 'défi déjà ouvert')
})

Deno.test('trois jours sans réponse, puis on se tait', () => {
  const dernier = { jour: '2026-11-01', ouvertLe: ouvertLe('2026-11-01', 12) }
  egal(rappelDu(dernier, '2026-11-02', paris('2026-11-02', 12)), true, 'jour 1')
  egal(rappelDu(dernier, '2026-11-03', paris('2026-11-03', 12)), true, 'jour 2')
  egal(rappelDu(dernier, '2026-11-04', paris('2026-11-04', 12)), true, 'jour 3')
  egal(rappelDu(dernier, '2026-11-05', paris('2026-11-05', 12)), false, 'jour 4')
  egal(rappelDu(null, '2026-11-05', paris('2026-11-05', 12)), false, 'aucun défi récent')
})

Deno.test('le changement d’heure ne décale pas le compte des jours', () => {
  const avant = { jour: '2026-10-24', ouvertLe: '2026-10-24T18:00:00Z' }
  egal(rappelDu(avant, '2026-10-25', Date.parse('2026-10-25T19:30:00Z')), true, 'dimanche du passage à l’heure d’hiver')
})

Deno.test('le message dit la série, sans menace', () => {
  egal(messageDuRappel(5).body, 'Ta série en est à 5 jours.', 'avec une série')
  egal(messageDuRappel(1).body, 'Une nouvelle grille, quand tu veux aujourd’hui.', 'un seul jour')
  egal(messageDuRappel(0).body, 'Une nouvelle grille, quand tu veux aujourd’hui.', 'sans série')
  egal(messageDuRappel(5).data.type, 'daily_reminder', 'le type')
  egal(messageDuRappel(5).channel, 'motman_defi', 'son canal, coupable à part dans Android')
})

Deno.test('le dernier défi de chacun, quel que soit l’ordre', () => {
  const derniers = derniersDefis([
    { user_id: 'a', day: '2026-11-01', created_at: 'x' },
    { user_id: 'a', day: '2026-10-30', created_at: 'y' },
    { user_id: 'b', day: '2026-10-31', created_at: 'z' },
  ])
  egal(derniers.get('a')?.jour, '2026-11-01', 'a')
  egal(derniers.get('a')?.ouvertLe, 'x', 'son heure à lui')
  egal(derniers.get('b')?.jour, '2026-10-31', 'b')
})
