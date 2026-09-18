import { beforeEach, describe, expect, it, vi } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// LA RÉCOMPENSE DEMANDÉE DÈS LA FIN DE PARTIE.
//
// La partie la précharge à l'instant où elle se voit terminée ; l'écran de fin
// reprend LA MÊME demande. Ce qui compte : un seul aller-retour par partie, et
// un échec qui ne reste pas en cache (sinon l'écran de fin n'aurait jamais sa
// récompense après un réseau capricieux).
// ─────────────────────────────────────────────────────────────────────────────

const compte = vi.hoisted(() => ({ lire: vi.fn() }))
vi.mock('../auth', () => ({ refreshPlayerAccount: compte.lire }))

import { oublierRecompensesPourTest, prechargerRecompense, recompenseDuMatch } from './matchRewardPrefetch'

const recompense = (matchId: string) => ({ id: `server:match:${matchId}`, breakdown: { total: 42 } })

beforeEach(() => {
  oublierRecompensesPourTest()
  compte.lire.mockReset()
})

describe('la récompense de fin de partie', () => {
  it('précharger puis afficher ne fait qu’UN aller-retour', async () => {
    compte.lire.mockResolvedValue({ progress: { experienceAwards: [recompense('m1')] } })
    void prechargerRecompense('m1')
    const trouvee = await recompenseDuMatch('m1')
    expect(trouvee?.id).toBe('server:match:m1')
    expect(compte.lire).toHaveBeenCalledTimes(1)
  })

  it('rend null quand le compte ne porte pas la récompense de cette partie', async () => {
    compte.lire.mockResolvedValue({ progress: { experienceAwards: [recompense('autre')] } })
    expect(await recompenseDuMatch('m2')).toBeNull()
  })

  it('un échec n’est pas gardé : la demande suivante repart', async () => {
    compte.lire.mockRejectedValueOnce(new Error('réseau'))
    await expect(prechargerRecompense('m3')).rejects.toThrow('réseau')
    compte.lire.mockResolvedValue({ progress: { experienceAwards: [recompense('m3')] } })
    expect((await recompenseDuMatch('m3'))?.id).toBe('server:match:m3')
    expect(compte.lire).toHaveBeenCalledTimes(2)
  })

  it('chaque partie a sa propre demande', async () => {
    compte.lire.mockResolvedValue({ progress: { experienceAwards: [recompense('a'), recompense('b')] } })
    await recompenseDuMatch('a')
    await recompenseDuMatch('b')
    expect(compte.lire).toHaveBeenCalledTimes(2)
  })
})
