import { useCallback, useEffect, useState } from 'react'
import type { TurnStep } from './game/turnChoreography'

export type SensoryPreferences = {
  effects: boolean
  vibration: boolean
  /** Les animations du jeu. Voir `installMotionAttribute` plus bas. */
  animations: boolean
}

export type GameEffect = 'pick' | 'place' | 'score' | 'word' | 'error' | 'turn' | 'reroll'

const STORAGE_KEY = 'motman-sensory-preferences-v1'
const CHANGE_EVENT = 'motman:sensory-preferences'
// ⚠️ ANIMATIONS À `true` PAR DÉFAUT, MÊME SI L'APPAREIL DEMANDE MOINS
// D'ANIMATIONS (16/09/2026, décision du propriétaire). Avant, tout le CSS
// dépendait directement de `prefers-reduced-motion` : un joueur qui avait coupé
// les animations dans Windows — ce qui arrive sans le vouloir sur beaucoup de
// machines — jouait à un MotMan sans vie, sans aucun moyen de les rallumer. Le
// jeu décide donc lui-même, et ce réglage rend la main à celui que le mouvement
// dérange.
const DEFAULTS: SensoryPreferences = { effects: true, vibration: true, animations: true }

let audioContext: AudioContext | null = null

export function loadSensoryPreferences(): SensoryPreferences {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<SensoryPreferences>
    return {
      effects: typeof stored.effects === 'boolean' ? stored.effects : DEFAULTS.effects,
      vibration: typeof stored.vibration === 'boolean' ? stored.vibration : DEFAULTS.vibration,
      animations: typeof stored.animations === 'boolean' ? stored.animations : DEFAULTS.animations,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveSensoryPreferences(preferences: SensoryPreferences): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences))
  window.dispatchEvent(new CustomEvent<SensoryPreferences>(CHANGE_EVENT, { detail: preferences }))
}

export function useSensoryPreferences() {
  const [preferences, setPreferences] = useState<SensoryPreferences>(loadSensoryPreferences)

  useEffect(() => {
    const sync = (event: Event) => setPreferences((event as CustomEvent<SensoryPreferences>).detail)
    window.addEventListener(CHANGE_EVENT, sync)
    return () => window.removeEventListener(CHANGE_EVENT, sync)
  }, [])

  const setPreference = useCallback((key: keyof SensoryPreferences, value: boolean) => {
    const next = { ...loadSensoryPreferences(), [key]: value }
    saveSensoryPreferences(next)
    setPreferences(next)
  }, [])

  return { preferences, setPreference }
}

/**
 * Les animations sont-elles coupées ? Une seule réponse pour le CSS
 * (`html[data-motion="off"]`) et pour le JavaScript, qui raccourcit alors ses
 * comptes à rebours et ses défilements.
 */
export function motionReduced(): boolean {
  return !loadSensoryPreferences().animations
}

/**
 * Pose `data-motion` sur la page, et le tient à jour. À appeler au démarrage
 * (main.tsx) : tout le CSS d'animation est accroché à cet attribut.
 */
export function installMotionAttribute(win: Window = window): void {
  const appliquer = () => {
    win.document.documentElement.dataset.motion = loadSensoryPreferences().animations ? 'on' : 'off'
  }
  appliquer()
  win.addEventListener(CHANGE_EVENT, appliquer)
}

export function haptic(pattern: number | number[]): void {
  if (!loadSensoryPreferences().vibration) return
  // Safari iPhone n'a pas d'API de vibration. L'astuce de l'interrupteur natif
  // d'iOS 18 a été essayée puis retirée (14/09/2026) : testé sur un vrai iPhone,
  // iOS ne vibre que si le doigt touche l'interrupteur, jamais quand la page le
  // bascule. Seule une appli iPhone native (@capacitor/haptics) le permettrait.
  navigator.vibrate?.(pattern)
}

const EFFECT_NOTES: Record<GameEffect, ReadonlyArray<readonly [frequency: number, delay: number, duration: number, volume: number]>> = {
  // La prise : plus aiguë, plus brève et plus douce que la pose. On attrape une
  // lettre bien plus souvent qu'on ne marque — ce son doit rester un effleurement.
  pick: [[587, 0, .035, .007]],
  place: [[330, 0, .055, .012]],
  score: [[440, 0, .08, .016]],
  word: [[392, 0, .1, .017], [523, .085, .16, .019]],
  error: [[196, 0, .13, .012]],
  turn: [[392, 0, .1, .014], [494, .13, .18, .016]],
  reroll: [[330, 0, .07, .012], [392, .075, .13, .014]],
}

// ─────────────────────────────────────────────────────────────────────────────
// LA MONTÉE.
//
// Chaque bonne lettre d'un tour jouait la même note : cinq lettres justes, cinq
// bips identiques — c'est ce qui donnait au jeu son côté mécanique. Ici chaque
// bonne lettre monte d'un cran sur une gamme pentatonique (aucun enchaînement
// n'y sonne faux), si bien qu'un bon tour s'ENTEND grimper. Le mot terminé
// sonne en haut de la montée qui l'a construit.
//
// Une erreur remet la montée au pied : la suite de bonnes lettres est rompue,
// et l'oreille doit l'entendre autant que l'œil le voit.
// ─────────────────────────────────────────────────────────────────────────────

/** Demi-tons au-dessus de la note de base, cran par cran. Plafonnée à l'octave. */
export const SCORE_LADDER: readonly number[] = [0, 2, 4, 7, 9, 12]

/** Transposition, en demi-tons, du son de chaque étape d'un tour. */
export function ladderFor(kinds: readonly TurnStep['kind'][]): number[] {
  const sommet = SCORE_LADDER.length - 1
  let crans = 0
  return kinds.map(kind => {
    if (kind === 'wrong') { crans = 0; return 0 }
    if (kind === 'correct') {
      const hauteur = SCORE_LADDER[Math.min(crans, sommet)]
      crans += 1
      return hauteur
    }
    // Mot ou chevalet : en haut de ce qui vient d'être gravi, sans monter d'un cran.
    return SCORE_LADDER[Math.min(Math.max(crans - 1, 0), sommet)]
  })
}

export function playEffect(effect: GameEffect, options: { transpose?: number } = {}): void {
  if (!loadSensoryPreferences().effects) return
  const rapport = 2 ** ((options.transpose ?? 0) / 12)
  const AudioContextConstructor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextConstructor) return

  try {
    audioContext ??= new AudioContextConstructor()
    const context = audioContext
    const play = () => {
      const start = context.currentTime + .012
      EFFECT_NOTES[effect].forEach(([frequency, delay, duration, volume]) => {
        const oscillator = context.createOscillator()
        const gain = context.createGain()
        oscillator.type = 'sine'
        oscillator.frequency.setValueAtTime(frequency * rapport, start + delay)
        gain.gain.setValueAtTime(.0001, start + delay)
        gain.gain.exponentialRampToValueAtTime(volume, start + delay + .018)
        gain.gain.exponentialRampToValueAtTime(.0001, start + delay + duration)
        oscillator.connect(gain)
        gain.connect(context.destination)
        oscillator.start(start + delay)
        oscillator.stop(start + delay + duration + .025)
      })
    }
    if (context.state === 'suspended') void context.resume().then(play).catch(() => undefined)
    else play()
  } catch {
    // Les retours sonores restent un agrément : ils ne doivent jamais bloquer le jeu.
  }
}
