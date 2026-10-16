import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// On ne parle pas de bot (propriétaire, 16/10/2026) : « si on dit pas alors y a
// rien à savoir ». Ni que l'adversaire est un bot, ni qu'il est un vrai joueur.
// La carte Normal disait depuis septembre « Un bot à ton niveau prend la
// place », et les pages publiques « contre un ami, un joueur ou un bot ».
//
// Le code garde ses noms (`match.bot`, `'bot'`, `.bot-play`) : on ne cherche que
// des phrases. Les « robots » de Turnstile (anti-abus) sont un autre sujet.

function fichiers(dossier: string, extensions: RegExp): string[] {
  return readdirSync(dossier).flatMap(nom => {
    const chemin = join(dossier, nom)
    if (statSync(chemin).isDirectory()) return fichiers(chemin, extensions)
    return extensions.test(nom) && !/\.test\./.test(nom) ? [chemin] : []
  })
}

function sansCommentaires(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const PHRASE_DE_BOT = /\b(un|le|les|des|du|au|aux|ton|contre|d['’]un)\s+bots?\b/gi
const MOT_BOT = /\bbots?\b/gi

function trouvailles(chemin: string, texte: string, motif: RegExp): string[] {
  return [...texte.matchAll(motif)].map(m => `${chemin} : « ${texte.slice(Math.max(0, m.index - 40), m.index + 40).replace(/\s+/g, ' ')} »`)
}

describe('aucun bot à l’écran', () => {
  it('ni dans les écrans de l’appli', () => {
    const vus = fichiers('src', /\.tsx?$/).flatMap(chemin => trouvailles(chemin, sansCommentaires(readFileSync(chemin, 'utf8')), PHRASE_DE_BOT))
    expect(vus).toEqual([])
  })

  it('ni dans les nouveautés', () => {
    const rapports = JSON.parse(readFileSync('src/nouveautes.rapports.json', 'utf8')) as { titre: string; texte: string }[]
    const vus = rapports.flatMap(r => trouvailles('nouveautes', `${r.titre} — ${r.texte}`, MOT_BOT))
    expect(vus).toEqual([])
  })

  it('ni dans les pages publiques', () => {
    const pages = ['index.html', ...fichiers('public', /\.html$/)]
    const vus = pages.flatMap(chemin => trouvailles(chemin, readFileSync(chemin, 'utf8'), MOT_BOT))
    expect(vus).toEqual([])
  })
})
