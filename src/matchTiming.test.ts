import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// LA FENÊTRE DE LECTURE EST ÉCRITE TROIS FOIS.
//
// Le premier tour d'une partie en temps limité ne démarre qu'après trente
// secondes de lecture. Cette durée vit dans trois langages, parce qu'aucun n'importe les
// autres :
//
//   • `matchSetup.ts` (fonction edge, Deno) — les parties normales et le défi ;
//   • une migration plpgsql — les parties CLASSÉES démarrent en SQL, quand les
//     deux joueurs ont accepté la confirmation ;
//   • `server/match/config.ts` — le serveur de test qui porte les e2e.
//
// Les laisser diverger donnerait un jeu qui n'a pas les mêmes règles selon le
// mode : dix secondes de lecture en normal, deux en classé. C'est le motif de
// bogue le plus coûteux de ce projet, et il ne se voit pas à la relecture.
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

function nombre(source: string, motif: RegExp): number {
  const brut = motif.exec(source)?.[1]
  if (!brut) throw new Error(`Valeur introuvable pour ${motif}`)
  return Number(brut.replace(/_/g, ''))
}

describe('la fenêtre de lecture du premier tour', () => {
  const reglage = readFileSync('supabase/functions/match-api/matchSetup.ts', 'utf8')
  const modele = readFileSync('supabase/functions/match-api/matchModel.ts', 'utf8')
  const lectureMs = nombre(reglage, /FIRST_TURN_READING_MS = ([\d_]+)/)
  const tourMs = nombre(modele, /REALTIME_TURN_MS = ([\d_]+)/)

  it('dure trente secondes, et le tour garde ses quarante-cinq', () => {
    expect(lectureMs).toBe(30_000)
    expect(tourMs).toBe(45_000)
  })

  it('ne s’applique qu’au temps limité : l’illimité garde sa brève préparation', () => {
    expect(reglage).toContain("pace === 'realtime' ? FIRST_TURN_READING_MS : READY_MS")
    // Les deux créations de partie de la fonction edge, pas une seule.
    expect(reglage.split("pace === 'realtime' ? FIRST_TURN_READING_MS : READY_MS").length - 1).toBe(2)
  })

  it('vaut la même chose côté classé, qui démarre sa partie en plpgsql', () => {
    const sql = derniereMigration('server_respond_ranked_ready_atomic')
    const debut = nombre(sql, /turn_started_at = pg_catalog\.clock_timestamp\(\) \+ interval '(\d+(?:\.\d+)?) seconds'/)
    const fin = nombre(sql, /turn_ends_at = pg_catalog\.clock_timestamp\(\) \+ interval '(\d+(?:\.\d+)?) seconds'/)
    expect(debut * 1_000).toBe(lectureMs)
    // Le tour entier court APRÈS la lecture : 30 s + 45 s.
    expect(fin * 1_000).toBe(lectureMs + tourMs)
  })

  it('vaut la même chose sur le serveur de test, sinon les e2e testent autre chose', () => {
    const local = readFileSync('server/match/config.ts', 'utf8')
    expect(nombre(local, /FIRST_TURN_READING_MS = numericEnvironment\('MOTMAN_FIRST_TURN_READING_MS', ([\d_]+)/)).toBe(lectureMs)
  })
})

describe('le seuil de bascule sur un bot', () => {
  it('vaut la même chose côté client et côté serveur', async () => {
    const { BOT_SEARCH_MS } = await import('./menuSyncPolicy')
    const serveur = readFileSync('supabase/functions/match-api/index.ts', 'utf8')
    expect(nombre(serveur, /BOT_SEARCH_MS = ([\d_]+)/)).toBe(BOT_SEARCH_MS)
  })
})
