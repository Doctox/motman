import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// CE QUE LA FILE CLASSÉE RENVOIE, ET CE QUE match-api EN LIT (10/10/2026).
//
// `advanceRankedSearch` n'envoyait la notification « Match classé trouvé » que
// si la procédure `server_ranked_matchmake_atomic` renvoyait `match`. Elle ne
// l'a jamais renvoyé : la branche était morte depuis juillet, et un joueur passé
// en arrière-plan ratait ses trente secondes pour accepter. Rien ne le montrait
// à la relecture — les deux moitiés vivent dans deux langages, deux fichiers.
//
// Ce test lit les deux : toute clé que ranked.ts lit sur la réponse engagée
// (`committed.<clé>`) doit figurer dans l'objet que la procédure renvoie quand
// elle ouvre la confirmation (`'status', 'ready'`).
// ─────────────────────────────────────────────────────────────────────────────

/** La dernière migration qui redéfinit cette fonction fait foi. */
function derniereMigration(fonction: string): string {
  const dossier = 'supabase/migrations'
  const trouvee = readdirSync(dossier).sort().reverse()
    .map(nom => readFileSync(`${dossier}/${nom}`, 'utf8'))
    .find(sql => sql.includes(`function public.${fonction}`))
  if (!trouvee) throw new Error(`Aucune migration ne définit ${fonction}`)
  return trouvee
}

/** Les clés de chaque `jsonb_build_object(...)` qui pose `'status', '<statut>'`. */
function clesRenvoyees(sql: string, statut: string): Set<string> {
  const cles = new Set<string>()
  for (const objet of sql.matchAll(/jsonb_build_object\(([^;]*?)\)\s*;/g)) {
    const corps = objet[1]
    if (!new RegExp(`'status',\\s*'${statut}'`).test(corps)) continue
    for (const cle of corps.matchAll(/'([A-Za-z]+)'\s*,/g)) cles.add(cle[1])
  }
  return cles
}

describe('la réponse de server_ranked_matchmake_atomic', () => {
  const sql = derniereMigration('server_ranked_matchmake_atomic')
  const pret = clesRenvoyees(sql, 'ready')

  it('ouvre la confirmation avec son identifiant de session et de partie', () => {
    for (const cle of ['status', 'readySessionId', 'matchId', 'opponentId', 'created']) expect(pret.has(cle), cle).toBe(true)
  })

  it('porte toutes les clés que ranked.ts lit sur la réponse engagée', () => {
    // Le code seulement : un commentaire qui raconte l'ancien défaut n'est pas une lecture.
    const ranked = readFileSync('supabase/functions/match-api/ranked.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
    const lues = new Set([...ranked.matchAll(/committed\.([A-Za-z]+)/g)].map(trouve => trouve[1]))
    expect(lues.size).toBeGreaterThan(0)
    const absentes = [...lues].filter(cle => !pret.has(cle))
    expect(absentes, `ranked.ts lit des clés que la procédure ne renvoie pas : ${absentes.join(', ')}`).toEqual([])
  })
})
