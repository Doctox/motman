import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { botThinkingDelayMs, createBotPersona } from './botOpponents'
import { seedFromDate } from './dailyCalendar'
import { generateGrid } from './generator'
import { fantomeReflexionMs } from './ghostOpponent'
import { selectGridForPlayers } from './gridSelection'
import { fnv1a } from './hachage'
import { publicGrid } from '../supabase/functions/match-api/matchGrid'

// ─────────────────────────────────────────────────────────────────────────────
// LE HACHAGE FNV-1a, FIGÉ (22/10/2026, ménage K4).
//
// Le même hachage était recopié huit fois (client, match-api, script du
// calendrier). Il tire le bot, sa réflexion, celle du fantôme, la grille d'une
// partie, l'indice, le défi du jour de repli… Il ne vit plus que dans
// `src/hachage.ts`. Ces nombres ont été relevés AVANT la fusion, sur les
// copies : si l'un bouge, un tirage a changé pour les joueurs.
// ─────────────────────────────────────────────────────────────────────────────

const FIGEES: Array<[string, number]> = [
  ['', 2166136261],
  ['a', 3826002220],
  ['A', 3289118412],
  ['2026-10-22', 3665287038],
  ['2026-08-16', 1023364550],
  ['2026-10-22|grille-a', 1243734463],
  ['grille-0042', 306732087],
  ['0b6c1f2e-8d4a-4c3e-9f21-7a5d3e9b1c40:3:hint', 1683678456],
  ['Théo', 1159486885],
  ['éàçœ', 3291496806],
  // Un émoji (deux unités UTF-16) : `for…of` parcourt le caractère entier, et
  // `charCodeAt(0)` n'en lit que la première moitié. C'est la règle d'origine,
  // à ne pas « corriger » : tous les tirages en dépendent.
  ['🎲', 948053755],
  ['x'.repeat(200), 3018110693],
]

describe('FNV-1a : une seule écriture, les mêmes tirages', () => {
  it('rend les nombres relevés avant la fusion', () => {
    for (const [texte, attendu] of FIGEES) {
      expect(fnv1a(texte), texte).toBe(attendu)
      expect(seedFromDate(texte), texte).toBe(attendu)
    }
  })

  it('le bot réfléchit et se présente comme avant', () => {
    expect(['partie-1:1', 'partie-1:2', 'abc:7'].map(botThinkingDelayMs)).toEqual([5367, 4564, 5855])
    expect(createBotPersona('graine-fixe')).toEqual({ displayName: 'Théo', level: 6, skill: 'beginner', avatarId: 'alex', frameId: 'cadre-laiton' })
    expect(createBotPersona('graine-fixe', 'expert')).toEqual({ displayName: 'Théo', level: 47, skill: 'expert', avatarId: 'alex', frameId: 'cadre-laiton' })
    expect(createBotPersona('autre-graine', 'beginner')).toEqual({ displayName: 'Clara', level: 7, skill: 'beginner', avatarId: 'amina', frameId: 'cadre-sauge' })
  })

  it('le fantôme réfléchit comme avant', () => {
    expect(['partie-1:1', 'partie-1:2', 'abc:7'].map(fantomeReflexionMs)).toEqual([14474, 15188, 16265])
  })

  it('la grille d’une partie se tire comme avant', () => {
    const grilles = Array.from({ length: 10 }, (_, k) => ({ id: `grille-${k}`, words: [{ answer: `MOT${k}` }] }))
    const tirees = Array.from({ length: 10 }, (_, k) => selectGridForPlayers({
      grids: grilles, recentGridIdsByPlayer: [], playCountsByPlayer: [], activeGridIds: [], seed: `s${k}`,
    }).grid.id)
    expect(tirees).toEqual(['grille-0', 'grille-9', 'grille-2', 'grille-1', 'grille-6', 'grille-5', 'grille-8', 'grille-7', 'grille-2', 'grille-1'])
  })

  it('la graine d’une grille est le hachage de son identifiant, côté client comme côté serveur', async () => {
    const grille = await generateGrid(0)
    expect(grille.seed).toBe(fnv1a(grille.id))
    const grilleServeur = {
      id: 'grille-0042', columns: 6, rows: 2, clueCells: [0, 1, 2, 3, 4, 5].map(colonne => [1, colonne]),
      words: [{ answer: 'MOTIFS', direction: 'across' as const, clueCell: [1, 0], cells: [0, 1, 2, 3, 4, 5].map(colonne => [0, colonne]) }],
    }
    expect(publicGrid(grilleServeur).seed).toBe(306732087)
  })
})

describe('une seule écriture', () => {
  // Les fichiers SUIVIS par git, et eux seuls : les outils locaux gardés hors du
  // dépôt (scripts/filmer_*.mjs, ignorés) ont le droit d'avoir leur copie.
  function fichiersSuivis(dossiers: string[]): string[] {
    return execFileSync('git', ['ls-files', '--', ...dossiers], { encoding: 'utf8' })
      .split('\n')
      .filter(chemin => /\.(ts|tsx|mjs)$/.test(chemin) && !chemin.split('/').includes('data'))
  }

  it('la constante de FNV-1a n’apparaît que dans src/hachage.ts', () => {
    const copies = fichiersSuivis(['src', 'server', 'scripts', 'supabase/functions'])
      .filter(fichier => !fichier.endsWith('.test.ts') && /\b2166136261\b/.test(readFileSync(fichier, 'utf8')))
    expect(copies).toEqual(['src/hachage.ts'])
  })

  it('n’importe rien : scripts/build_daily_calendar.mjs le charge seul (importTs)', () => {
    expect(readFileSync('src/hachage.ts', 'utf8')).not.toMatch(/^\s*import\s/m)
  })
})
