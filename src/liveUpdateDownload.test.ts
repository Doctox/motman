import { beforeEach, describe, expect, it, vi } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// TÉLÉCHARGER ET APPLIQUER UNE MISE À JOUR — le câblage avec le module natif.
//
// Le module est simulé : ce qui se vérifie ici, c'est ce que NOTRE code lui
// demande — réutiliser une version déjà là, rapporter la progression, ne jamais
// laisser traîner l'écouteur, et appliquer tout de suite ou plus tard selon ce
// que le joueur a choisi.
// ─────────────────────────────────────────────────────────────────────────────

const module = vi.hoisted(() => ({
  list: vi.fn(),
  download: vi.fn(),
  addListener: vi.fn(),
  set: vi.fn(),
  next: vi.fn(),
  retirer: vi.fn(),
  ecouteur: null as null | ((event: { percent: number }) => void),
}))

vi.mock('@capgo/capacitor-updater', () => ({
  CapacitorUpdater: {
    list: module.list,
    download: module.download,
    set: module.set,
    next: module.next,
    addListener: module.addListener,
  },
}))

import { applyLiveUpdateLater, applyLiveUpdateNow, downloadLiveUpdate } from './liveUpdate'
import { LIVE_UPDATE_BASE_URL, type LiveUpdateManifest } from './liveUpdateManifest'

const manifeste: LiveUpdateManifest = {
  version: 104,
  url: `${LIVE_UPDATE_BASE_URL}bundle-104.zip`,
  checksum: 'a'.repeat(64),
  minNativeVersionCode: 8,
  builtAt: '2026-09-13T18:00:00.000Z',
  size: 11_458_121,
}

beforeEach(() => {
  Object.values(module).forEach(valeur => { if (typeof valeur === 'function' && 'mockReset' in valeur) valeur.mockReset() })
  module.ecouteur = null
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} })
  module.addListener.mockImplementation(async (_nom: string, ecouteur: (event: { percent: number }) => void) => {
    module.ecouteur = ecouteur
    return { remove: module.retirer }
  })
})

describe('télécharger', () => {
  it('rapporte la progression, puis rend la version téléchargée', async () => {
    module.list.mockResolvedValue({ bundles: [] })
    module.download.mockImplementation(async () => {
      module.ecouteur?.({ percent: 30 })
      module.ecouteur?.({ percent: 75 })
      return { id: 'nouvelle', version: '104', status: 'success' }
    })
    const progression: number[] = []
    const id = await downloadLiveUpdate(manifeste, valeur => progression.push(valeur))
    expect(id).toBe('nouvelle')
    expect(progression).toEqual([30, 75, 100])
    expect(module.download).toHaveBeenCalledWith({ url: manifeste.url, version: '104', checksum: manifeste.checksum })
  })

  it('ne retélécharge pas une version déjà là', async () => {
    module.list.mockResolvedValue({ bundles: [{ id: 'deja', version: '104', status: 'success' }] })
    const progression: number[] = []
    expect(await downloadLiveUpdate(manifeste, valeur => progression.push(valeur))).toBe('deja')
    expect(module.download).not.toHaveBeenCalled()
    expect(progression).toEqual([100])
  })

  it('retire son écouteur, même quand le téléchargement échoue', async () => {
    // Sinon chaque ouverture en ajouterait un, et la progression d'un
    // téléchargement se rapporterait plusieurs fois.
    module.list.mockResolvedValue({ bundles: [] })
    module.download.mockRejectedValue(new Error('Checksum failed'))
    await expect(downloadLiveUpdate(manifeste, () => {})).rejects.toThrow('Checksum failed')
    expect(module.retirer).toHaveBeenCalled()
  })
})

describe('appliquer', () => {
  it('tout de suite : l’application redémarre sur la nouvelle version', async () => {
    await applyLiveUpdateNow('nouvelle', 104)
    expect(module.set).toHaveBeenCalledWith({ id: 'nouvelle' })
    expect(module.next).not.toHaveBeenCalled()
  })

  it('plus tard : le joueur joue, la version attend le prochain lancement', async () => {
    await applyLiveUpdateLater('nouvelle', 104)
    expect(module.next).toHaveBeenCalledWith({ id: 'nouvelle' })
    expect(module.set).not.toHaveBeenCalled()
  })
})
