// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'

import { installPressFeedback } from './pressFeedback'

// ─────────────────────────────────────────────────────────────────────────────
// LE RETOUR D'APPUI IMMÉDIAT.
//
// Ce que ces tests protègent n'est pas l'apparence — c'est le MOMENT. Le retour
// doit partir au premier contact du doigt, sans attendre l'heuristique de
// défilement de Chrome, et surtout il doit TOUJOURS se relâcher.
//
// Un bouton resté enfoncé parce qu'un événement a été manqué est pire que pas
// de retour du tout : l'interface paraît bloquée. D'où l'insistance sur les
// chemins de relâchement, `pointercancel` en tête — c'est lui qui part quand
// l'appui se transforme en défilement, le cas le plus fréquent sur téléphone.
// ─────────────────────────────────────────────────────────────────────────────

let demonter: (() => void) | null = null

afterEach(() => { demonter?.(); demonter = null; document.body.innerHTML = '' })

function scene() {
  document.body.innerHTML = `
    <div id="page">
      <button id="ok">Jouer</button>
      <button id="ko" disabled>Indisponible</button>
      <span id="faux-bouton" role="button">Faux</span>
      <span id="fige" role="button" aria-disabled="true">Figé</span>
      <p id="texte">pas un bouton</p>
    </div>`
  demonter = installPressFeedback(document)
  const el = (id: string) => document.getElementById(id)!
  const evenement = (nom: string, cible: Element) => cible.dispatchEvent(
    new Event(nom, { bubbles: true, cancelable: true }))
  return { el, evenement }
}

describe('le retour part au premier contact', () => {
  it('marque le bouton dès `pointerdown`, sans attendre `:active`', () => {
    const { el, evenement } = scene()
    evenement('pointerdown', el('ok'))
    expect(el('ok').classList.contains('is-pressed')).toBe(true)
  })

  it('marque aussi un élément qui joue le rôle de bouton', () => {
    const { el, evenement } = scene()
    evenement('pointerdown', el('faux-bouton'))
    expect(el('faux-bouton').classList.contains('is-pressed')).toBe(true)
  })

  it('remonte au bouton parent quand le doigt touche son contenu', () => {
    // On touche presque toujours l'icône ou le libellé, jamais le bouton nu.
    document.body.innerHTML = '<button id="ok"><svg id="icone"></svg><span id="mot">Jouer</span></button>'
    demonter = installPressFeedback(document)
    document.getElementById('mot')!.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(document.getElementById('ok')!.classList.contains('is-pressed')).toBe(true)
  })
})

describe('ce qui ne doit pas réagir', () => {
  it('ignore un bouton désactivé', () => {
    const { el, evenement } = scene()
    evenement('pointerdown', el('ko'))
    expect(el('ko').classList.contains('is-pressed')).toBe(false)
  })

  it('ignore un élément marqué `aria-disabled`', () => {
    const { el, evenement } = scene()
    evenement('pointerdown', el('fige'))
    expect(el('fige').classList.contains('is-pressed')).toBe(false)
  })

  it('ignore ce qui n’est pas cliquable', () => {
    const { el, evenement } = scene()
    evenement('pointerdown', el('texte'))
    expect(document.querySelectorAll('.is-pressed').length).toBe(0)
  })
})

describe('le relâchement est à toute épreuve', () => {
  for (const nom of ['pointerup', 'pointercancel', 'pointerleave', 'dragstart']) {
    it(`relâche sur \`${nom}\``, () => {
      const { el, evenement } = scene()
      evenement('pointerdown', el('ok'))
      evenement(nom, el('ok'))
      expect(el('ok').classList.contains('is-pressed')).toBe(false)
    })
  }

  it('relâche quand la page se met à défiler', () => {
    // Le cas le plus frequent sur telephone : l'appui devient un glissement.
    const { el, evenement } = scene()
    evenement('pointerdown', el('ok'))
    window.dispatchEvent(new Event('scroll'))
    expect(el('ok').classList.contains('is-pressed')).toBe(false)
  })

  it('ne laisse jamais deux boutons enfoncés à la fois', () => {
    const { el, evenement } = scene()
    evenement('pointerdown', el('ok'))
    evenement('pointerdown', el('faux-bouton'))
    expect(document.querySelectorAll('.is-pressed').length).toBe(1)
    expect(el('faux-bouton').classList.contains('is-pressed')).toBe(true)
  })

  it('nettoie tout au démontage', () => {
    const { el, evenement } = scene()
    evenement('pointerdown', el('ok'))
    demonter!()
    demonter = null
    expect(el('ok').classList.contains('is-pressed')).toBe(false)
    // Et plus rien ne réagit ensuite.
    el('ok').dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(el('ok').classList.contains('is-pressed')).toBe(false)
  })
})
