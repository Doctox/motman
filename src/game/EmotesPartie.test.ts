// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEmotesDeLaPartie } from './EmotesPartie'

// L'EMOTE DE L'ADVERSAIRE, À L'ARRIVÉE. Le serveur de test n'a pas de temps réel : les
// e2e voient l'envoi, ce banc voit la réception.

let racine: Root
let recevoir: (emote: string) => void
let ouvrir: ((portrait: HTMLElement) => void) | undefined
const envoyer = vi.fn()

function Ecran({ abonne }: { abonne: boolean }) {
  const emotes = useEmotesDeLaPartie('partie-1', abonne, envoyer)
  recevoir = emotes.recevoir
  ouvrir = emotes.ouvrir
  return emotes.calque
}

function poserLeScoreboard() {
  document.body.innerHTML = '<section class="scoreboard"><div class="player"><img class="game-portrait" /></div><div class="player player-you"><img class="game-portrait" /></div></section><div id="racine"></div>'
  const rect = (x: number) => ({ left: x, right: x + 40, top: 10, bottom: 50, width: 40, height: 40, x, y: 10, toJSON: () => ({}) }) as DOMRect
  document.querySelector('.player:not(.player-you) .game-portrait')!.getBoundingClientRect = () => rect(10)
  document.querySelector('.player:not(.player-you)')!.getBoundingClientRect = () => rect(0)
}

describe('l’emote de l’adversaire', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    envoyer.mockReset()
    poserLeScoreboard()
    racine = createRoot(document.getElementById('racine')!)
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    await act(async () => { racine.render(createElement(Ecran, { abonne: false })) })
  })
  afterEach(async () => {
    await act(async () => { racine.unmount() })
    vi.useRealTimers()
  })

  it('un joueur sans abonnement voit sa bulle, à droite de son portrait, puis elle s’efface', async () => {
    await act(async () => { recevoir('pouce') })
    const bulle = document.querySelector<HTMLElement>('.emote-bulle-bd.is-adverse')
    expect(bulle?.getAttribute('aria-label')).toBe('Pouce')
    expect(parseInt(bulle!.style.left, 10)).toBe(60)
    await act(async () => { vi.advanceTimersByTime(2_000) })
    expect(document.querySelector('.emote-bulle-bd')).toBeNull()
  })

  it('une emote inconnue ne montre rien', async () => {
    await act(async () => { recevoir('insulte') })
    expect(document.querySelector('.emote-bulle-bd')).toBeNull()
  })

  it('sans abonnement, le portrait n’ouvre rien et rien ne part', () => {
    expect(ouvrir).toBeUndefined()
    expect(envoyer).not.toHaveBeenCalled()
  })
})
