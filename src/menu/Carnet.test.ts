// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// LE CARNET À L'ÉCRAN (02/11/2026) : la ligne du profil et sa fenêtre, et ce que
// l'écran de fin d'un défi en dit. Les règles sont dans src/carnet.test.ts.
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('../sensoryPreferences', () => ({ haptic: vi.fn(), playEffect: vi.fn(), motionReduced: () => true }))
vi.mock('../dailyThemeSchedule', () => ({ dailyThemeFor: (jour: string) => jour === '2026-10-28' ? 'Mer & Marine' : null }))

import { DAILY_STORAGE_KEY, emptyDailyChallengeState } from '../dailyChallenge'
import { loadPlayerProgress, savePlayerProgress, type PlayerTitle } from '../playerProgress'
import { LigneDuCarnet, TimbreDuJour } from './Carnet'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const MOI = 'joueur-du-carnet'
const titre = (seuil: number, name: string) => ({ id: `carnet-${seuil}`, name, description: '', unlockType: 'special', requiredValue: seuil, unlocked: false }) as PlayerTitle
const TITRES = [titre(10, 'Premières pages'), titre(50, 'Un peu timbré')]
const jours = (nombre: number) => Array.from({ length: nombre }, (_, i) => new Date(Date.UTC(2026, 9, 28 + i)).toISOString().slice(0, 10))
const texte = (hote: HTMLElement) => (hote.textContent ?? '').replace(/ /g, ' ')

let racine: Root
let hote: HTMLDivElement

function semer(joues: string[], gagnes: string[] = []) {
  localStorage.setItem(DAILY_STORAGE_KEY, JSON.stringify({ ...emptyDailyChallengeState(), serverPlayDays: joues, serverWinDays: gagnes }))
}
const monter = (noeud: ReactNode) => act(async () => { racine.render(noeud) })

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  hote = document.createElement('div')
  document.body.append(hote)
  racine = createRoot(hote)
})
afterEach(() => {
  act(() => racine.unmount())
  hote.remove()
  vi.unstubAllGlobals()
})

describe('la ligne du profil', () => {
  it('dit le compte et ce qui reste', async () => {
    semer(jours(3))
    await monter(createElement(LigneDuCarnet, { titres: TITRES }))
    expect(texte(hote)).toContain('Ton carnet · 3 timbres')
    expect(texte(hote)).toContain('Encore 7 timbres pour le titre « Premières pages ».')
  })

  it('sans timbre, dit par où commencer', async () => {
    await monter(createElement(LigneDuCarnet, { titres: TITRES }))
    expect(texte(hote)).toContain('Ton premier timbre t’attend au défi du jour.')
    expect(texte(hote)).not.toContain('·')
  })
})

describe('la fenêtre du carnet', () => {
  const fenetre = () => document.querySelector<HTMLElement>('.mm-carnet')!
  const ouvrir = async () => { await act(async () => { hote.querySelector<HTMLElement>('.mm-carnet-ligne')!.click() }) }

  it('s’ouvre au toucher, avec un timbre par jour joué et un cachet par défi gagné', async () => {
    const joues = jours(3)
    semer(joues, [joues[0]])
    await monter(createElement(LigneDuCarnet, { titres: TITRES }))
    expect(fenetre()).toBeNull()
    await ouvrir()
    expect(fenetre().querySelectorAll('.mm-carnet-page .mm-timbre')).toHaveLength(3)
    expect(fenetre().querySelectorAll('.mm-timbre-cachet')).toHaveLength(1)
    expect(fenetre().querySelector('.mm-carnet-vide.is-suivante')?.textContent).toBe('4')
    expect(fenetre().querySelector('.mm-carnet-cadeau')?.textContent).toBe('10')
  })

  it('un toucher sur un timbre dit son thème, sa date et s’il a été gagné, un second le replie', async () => {
    const joues = jours(3)
    semer(joues, [joues[0]])
    await monter(createElement(LigneDuCarnet, { titres: TITRES }))
    await ouvrir()
    const timbre = fenetre().querySelector<HTMLElement>('.mm-carnet-page button')!
    await act(async () => { timbre.click() })
    expect(fenetre().querySelector('.mm-carnet-pied p')?.textContent).toMatch(/^Mer & Marine · 28 octobre( 2026)? · gagné$/)
    await act(async () => { timbre.click() })
    expect(texte(fenetre().querySelector('.mm-carnet-pied p')!)).toBe('Encore 7 timbres pour le titre « Premières pages ».')
  })

  it('un toucher sur le cadeau dit ce qu’il donne', async () => {
    semer(jours(3))
    await monter(createElement(LigneDuCarnet, { titres: TITRES }))
    await ouvrir()
    await act(async () => { fenetre().querySelector<HTMLElement>('.mm-carnet-cadeau')!.click() })
    expect(texte(fenetre().querySelector('.mm-carnet-pied p')!)).toBe('10 timbres : le titre « Premières pages ».')
  })

  it('tourne les pages, s’ouvre sur le dernier timbre et s’arrête au bout', async () => {
    semer(jours(20))
    await monter(createElement(LigneDuCarnet, { titres: TITRES }))
    await ouvrir()
    expect(fenetre().querySelector('.mm-carnet-pages span')?.textContent).toBe('Page 2')
    expect(fenetre().querySelectorAll('.mm-carnet-page .mm-timbre')).toHaveLength(4)
    await act(async () => { fenetre().querySelector<HTMLElement>('[aria-label="Page précédente"]')!.click() })
    expect(fenetre().querySelectorAll('.mm-carnet-page .mm-timbre')).toHaveLength(16)
    expect(fenetre().querySelector<HTMLButtonElement>('[aria-label="Page précédente"]')!.disabled).toBe(true)
  })

  it('une seule page : pas de flèches', async () => {
    semer(jours(3))
    await monter(createElement(LigneDuCarnet, { titres: TITRES }))
    await ouvrir()
    expect(fenetre().querySelector('.mm-carnet-pages')).toBeNull()
  })

  it('une place vide n’est pas un bouton', async () => {
    semer(jours(3))
    await monter(createElement(LigneDuCarnet, { titres: TITRES }))
    await ouvrir()
    expect(fenetre().querySelector('button.mm-carnet-vide')).toBeNull()
  })
})

describe('l’écran de fin du défi', () => {
  const titresDuCompte = () => savePlayerProgress({ ...loadPlayerProgress(MOI), titles: TITRES })

  it('montre le timbre gagné et ce qui reste', async () => {
    semer(jours(3))
    titresDuCompte()
    await monter(createElement(TimbreDuJour, { playerId: MOI, jour: '2026-10-30', gagne: true }))
    expect(texte(hote)).toContain('Un timbre de plus')
    expect(texte(hote)).toContain('3 timbres dans ton carnet · encore 7 pour le titre « Premières pages »')
    expect(hote.querySelector('.mm-timbre-cachet')).not.toBeNull()
  })

  it('une défaite donne aussi son timbre, sans cachet', async () => {
    semer(jours(3))
    titresDuCompte()
    await monter(createElement(TimbreDuJour, { playerId: MOI, jour: '2026-10-30', gagne: false }))
    expect(hote.querySelector('.mm-timbre')).not.toBeNull()
    expect(hote.querySelector('.mm-timbre-cachet')).toBeNull()
  })

  it('annonce le cadeau le jour où le seuil tombe', async () => {
    semer(jours(10))
    titresDuCompte()
    await monter(createElement(TimbreDuJour, { playerId: MOI, jour: '2026-11-06', gagne: true }))
    expect(texte(hote)).toContain('Tu gagnes le titre « Premières pages »')
    expect(texte(hote)).toContain('10 timbres dans ton carnet · encore 40 pour le titre « Un peu timbré »')
  })
})
