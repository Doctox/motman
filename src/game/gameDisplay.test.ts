import { describe, expect, it } from 'vitest'
import { compactClue } from './gameDisplay'

// ─────────────────────────────────────────────────────────────────────────────
// L'ÉNONCÉ AFFICHÉ SUR LA CASE.
//
// Le seuil de 30 caractères n'est pas un chiffre de confort : c'est la plus
// longue définition du catalogue, et elle a été essayée dans une vraie case sur
// le plus serré des téléphones courants (360x640) le 17/09/2026. Le
// commentaire de `gameDisplay.ts` porte le relevé complet.
//
// Ce banc d'essai le tient : si quelqu'un le rabaisse « pour que ça rentre
// mieux », il redécoupera des énoncés qui ne veulent plus rien dire.
// ─────────────────────────────────────────────────────────────────────────────

describe('l’énoncé affiché sur la case', () => {
  it('laisse passer entier ce qui tient', () => {
    // Les longueurs relevées au catalogue : médiane 18, p95 26, maximum 30.
    expect(compactClue('Résidu gratté')).toBe('Résidu gratté')
    expect(compactClue('Défenseur au tribunal')).toBe('Défenseur au tribunal')
    expect(compactClue('Mesure de champ anglaise')).toBe('Mesure de champ anglaise')
    // Pile au seuil : 30 caractères, la plus longue du catalogue.
    const trente = 'Devant revoir, pour se quitter'
    expect(trente).toHaveLength(30)
    expect(compactClue(trente)).toBe(trente)
    // Et celles qui s'en approchent, mesurées elles aussi dans une vraie case.
    expect(compactClue('Robot qui tient la discussion')).toBe('Robot qui tient la discussion')
    expect(compactClue('Course automobile chronométrée')).toBe('Course automobile chronométrée')
  })

  it('n’écourte que ce qui dépasse, et jamais en plein mot', () => {
    // Au-delà du catalogue actuel : le filet pour ce qui entrera plus tard.
    const trente = 'Devant revoir, pour se quitter et repartir'
    const court = compactClue(trente)
    expect(court.endsWith('…')).toBe(true)
    expect(court.length).toBeLessThanOrEqual(29)
    // La coupe tombe entre deux mots : pas de moitié de mot avant les points.
    expect(trente.startsWith(court.slice(0, -1))).toBe(true)
    expect(court.slice(0, -1).trimEnd()).toBe(court.slice(0, -1))
  })

  it('ne garde que la première idée : le reste est une précision', () => {
    expect(compactClue('Oiseau bavard ; il imite la voix')).toBe('Oiseau bavard')
    expect(compactClue('Métal précieux (symbole Au)')).toBe('Métal précieux')
    expect(compactClue('Arbre du Nord, qui perd ses aiguilles')).toBe('Arbre du Nord')
    expect(compactClue('Ville du Sud. On y voit la mer')).toBe('Ville du Sud')
  })

  it('tient debout devant un mot unique interminable', () => {
    // Aucun espace où couper : on tranche quand même, plutôt que de déborder.
    const seulMot = 'Anticonstitutionnellement'.repeat(2)
    const court = compactClue(seulMot)
    expect(court.endsWith('…')).toBe(true)
    expect(court.length).toBeLessThanOrEqual(29)
  })

  it('ne rend jamais une chaîne vide quand il y a du texte', () => {
    expect(compactClue('Mot')).toBe('Mot')
    expect(compactClue('  Espaces autour  ')).toBe('Espaces autour')
  })
})
