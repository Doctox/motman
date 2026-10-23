// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { InterrupteurFantome, libelleEnLigne, libelleSignalements, ligneDeSource, ligneDOmbre, noteDuFantome, nomDuCanal } from './GamePulse'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// L'accueil du propriétaire ne garde qu'une ligne : un nombre et ce mot. Zéro
// reste au singulier en français — « 0 joueurs en ligne » sur son écran le
// premier matin aurait été la faute la plus visible du jeu.
describe('le pouls dit combien d’autres joueurs sont là', () => {
  it('garde le singulier à zéro et à un', () => {
    expect(libelleEnLigne(0)).toBe('joueur en ligne')
    expect(libelleEnLigne(1)).toBe('joueur en ligne')
  })

  it('passe au pluriel à partir de deux', () => {
    expect(libelleEnLigne(2)).toBe('joueurs en ligne')
    expect(libelleEnLigne(37)).toBe('joueurs en ligne')
  })
})

// Le seul nombre de la carte qui appelle une ACTION : il a sa propre pastille,
// donc son propre accord (relevé du propriétaire, 21/09/2026 : son signalement
// avait attendu quatorze heures sans que rien ne le lui dise).
describe('la pastille des signalements', () => {
  it('garde le singulier à zéro et à un', () => {
    expect(libelleSignalements(0)).toBe('signalement')
    expect(libelleSignalements(1)).toBe('signalement')
  })

  it('passe au pluriel à partir de deux', () => {
    expect(libelleSignalements(2)).toBe('signalements')
  })
})

// 11/10/2026 : « mets-moi un on/off dans mon panel admin pour le fantôme ».
describe('l’interrupteur du fantôme', () => {
  async function monter(allumeAuDepart: boolean, basculer: (allume: boolean) => Promise<boolean>) {
    const hote = document.createElement('div')
    document.body.append(hote)
    const racine = createRoot(hote)
    await act(async () => { racine.render(createElement(InterrupteurFantome, { allumeAuDepart, basculer })) })
    const bouton = hote.querySelector('input[role="switch"]') as HTMLInputElement
    return { hote, racine, bouton }
  }

  it('éteint le fantôme et le dit', async () => {
    const basculer = vi.fn((allume: boolean) => Promise.resolve(allume))
    const { hote, racine, bouton } = await monter(true, basculer)
    expect(bouton.checked).toBe(true)
    await act(async () => { bouton.click() })
    expect(basculer).toHaveBeenCalledWith(false)
    expect(bouton.checked).toBe(false)
    expect(hote.textContent).toContain('les joueurs attendent un vrai adversaire')
    act(() => racine.unmount())
  })

  it('reste dans son état réel si le serveur refuse', async () => {
    const { hote, racine, bouton } = await monter(true, () => Promise.reject(new Error('403')))
    await act(async () => { bouton.click() })
    expect(bouton.checked).toBe(true)
    expect(hote.textContent).toContain('Réglage non enregistré')
    act(() => racine.unmount())
  })
})

describe('la note du fantôme', () => {
  it('dit sa note et son bilan, au singulier comme au pluriel', () => {
    expect(noteDuFantome({ points: 982, matches: 9, wins: 3, losses: 6, draws: 0 })).toBe('Sa note : 982 · 9 parties, 3 gagnées, 6 perdues')
    expect(noteDuFantome({ points: 1004, matches: 1, wins: 0, losses: 1, draws: 0 })).toBe('Sa note : 1004 · 1 partie, 0 gagnée, 1 perdue')
    expect(noteDuFantome({ points: 990, matches: 3, wins: 1, losses: 1, draws: 1 })).toBe('Sa note : 990 · 3 parties, 1 gagnée, 1 perdue, 1 nulle')
  })
})

describe('les joueurs de l’ombre dans le pouls', () => {
  const maintenant = Date.parse('2026-10-13T12:00:00Z')
  it('dit quand arrive celui qui n’est pas encore là', () => {
    expect(ligneDOmbre({ arrivee: '2026-10-16T12:00:00Z', points: 0, parties: 0 }, maintenant)).toBe('arrive le 16/10')
  })
  it('puis sa note et ses parties', () => {
    expect(ligneDOmbre({ arrivee: '2026-10-13T10:00:00Z', points: 0, parties: 0 }, maintenant)).toBe('arrivé·e, pas encore joué')
    expect(ligneDOmbre({ arrivee: '2026-10-13T10:00:00Z', points: 1012, parties: 7 }, maintenant)).toBe('1012 · 7 parties')
  })
})

// 17/10/2026 : « on a besoin de savoir d'où viennent les gens qui jouent ».
describe('d’où viennent les nouveaux', () => {
  it('nomme chaque canal en clair', () => {
    expect(nomDuCanal('play-store')).toBe('Play Store')
    expect(nomDuCanal('tiktok')).toBe('TikTok')
    expect(nomDuCanal('site')).toBe('Adresse tapée ou favori')
    expect(nomDuCanal('lien-flyer')).toBe('Lien « flyer »')
    expect(nomDuCanal('partage')).toBe('Défi partagé par un joueur')
    expect(nomDuCanal('ami')).toBe('Code ami partagé')
    expect(nomDuCanal('inconnu')).toBe('inconnu')
  })

  it('dit la semaine et les trente jours', () => {
    expect(ligneDeSource({ semaine: 3, mois: 7 })).toBe('3 cette semaine · 7 sur 30 jours')
  })
})
