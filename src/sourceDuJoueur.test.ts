import { describe, expect, it } from 'vitest'
import { canalDuLien, canalDuReferent, CLE_ARRIVEE, CLE_SOURCE, determinerSource, retenirSource } from './sourceDuJoueur'

// D'où viennent les joueurs (17/10/2026) : la version automatique, sans
// question posée au joueur.

const JEU = 'www.doctox.fr'
const web = (recherche: string, referent: string) => determinerSource({ recherche, referent, hoteDuJeu: JEU, plateforme: 'web' })

describe('le lien marqué', () => {
  it('reconnaît les réseaux sous leurs surnoms', () => {
    expect(canalDuLien('?src=instagram')).toBe('instagram')
    expect(canalDuLien('?src=insta')).toBe('instagram')
    expect(canalDuLien('?src=IG')).toBe('instagram')
    expect(canalDuLien('?src=tt')).toBe('tiktok')
    expect(canalDuLien('?src=yt')).toBe('youtube')
    expect(canalDuLien('?utm_source=facebook&utm_medium=social')).toBe('facebook')
  })

  it('garde lisible un marqueur inconnu, sans rien laisser passer d’autre', () => {
    expect(canalDuLien('?src=Flyer Café')).toBe('lien-flyer-cafe')
    expect(canalDuLien('?src=<script>')).toBe('lien-script')
    expect(canalDuLien('?src=' + 'x'.repeat(80))).toBe(`lien-${'x'.repeat(24)}`)
    expect(canalDuLien('')).toBeNull()
    expect(canalDuLien('?src=')).toBeNull()
  })
})

describe('la page précédente', () => {
  it('Google, quel que soit le pays, et les autres moteurs', () => {
    expect(canalDuReferent('https://www.google.fr/', JEU)).toEqual({ canal: 'google', hote: 'google.fr' })
    expect(canalDuReferent('https://www.google.co.uk/search?q=motman', JEU)?.canal).toBe('google')
    expect(canalDuReferent('https://duckduckgo.com/', JEU)?.canal).toBe('recherche')
    expect(canalDuReferent('https://www.bing.com/', JEU)?.canal).toBe('recherche')
  })

  it('les réseaux, par leur site ou par leur appli', () => {
    expect(canalDuReferent('https://l.instagram.com/?u=x', JEU)?.canal).toBe('instagram')
    expect(canalDuReferent('https://www.tiktok.com/@studiodoctox', JEU)?.canal).toBe('tiktok')
    expect(canalDuReferent('https://m.youtube.com/watch?v=x', JEU)?.canal).toBe('youtube')
    expect(canalDuReferent('https://lm.facebook.com/', JEU)?.canal).toBe('facebook')
    expect(canalDuReferent('android-app://com.zhiliaoapp.musically/', JEU)?.canal).toBe('tiktok')
    expect(canalDuReferent('android-app://com.instagram.android/', JEU)?.canal).toBe('instagram')
  })

  it('le Play Store n’est pas Google recherche', () => {
    expect(canalDuReferent('https://play.google.com/store/apps/details?id=com.motman.game', JEU)?.canal).toBe('play-store')
  })

  it('un autre site garde son nom, sans le chemin', () => {
    expect(canalDuReferent('https://forum.exemple.org/sujet/42?token=secret', JEU)).toEqual({ canal: 'autre', hote: 'forum.exemple.org' })
  })

  it('MotMan lui-même et le retour d’une connexion ne sont pas des arrivées', () => {
    expect(canalDuReferent('https://www.doctox.fr/motman/mots-fleches-en-duel/', JEU)).toBeNull()
    expect(canalDuReferent('https://doctox.fr/motman/', JEU)).toBeNull()
    expect(canalDuReferent('https://accounts.google.com/o/oauth2', JEU)).toBeNull()
    expect(canalDuReferent('https://kfacjvxzdtxybvxhfmzg.supabase.co/auth/v1/verify', JEU)).toBeNull()
    expect(canalDuReferent('', JEU)).toBeNull()
    expect(canalDuReferent('pas une adresse', JEU)).toBeNull()
  })
})

describe('la source retenue', () => {
  it('le lien marqué passe avant la page précédente', () => {
    expect(web('?src=tiktok', 'https://www.google.fr/').canal).toBe('tiktok')
  })

  it('sans indice : « site » sur le web, « play-store » dans l’appli Android', () => {
    expect(web('', '')).toEqual({ canal: 'site', hote: null, plateforme: 'web' })
    expect(determinerSource({ recherche: '', referent: '', hoteDuJeu: 'localhost', plateforme: 'android' }))
      .toEqual({ canal: 'play-store', hote: null, plateforme: 'android' })
  })

  it('arrivé de Google sur la page de présentation, puis « Jouer » : Google', () => {
    const source = determinerSource({
      recherche: '', referent: 'https://www.doctox.fr/motman/mots-fleches-en-duel/', hoteDuJeu: JEU, plateforme: 'web',
      arrivee: { referent: 'https://www.google.fr/', recherche: '' },
    })
    expect(source.canal).toBe('google')
  })

  it('la première source vue gagne, une fois pour toutes sur l’appareil', () => {
    const rangement = new Map<string, string>()
    const stockage = { getItem: (cle: string) => rangement.get(cle) ?? null, setItem: (cle: string, valeur: string) => { rangement.set(cle, valeur) } }
    expect(retenirSource(stockage, { recherche: '?src=insta', referent: '', hoteDuJeu: JEU, plateforme: 'web' }).canal).toBe('instagram')
    // Revenu le lendemain par son favori : toujours venu d'Instagram.
    expect(retenirSource(stockage, { recherche: '', referent: '', hoteDuJeu: JEU, plateforme: 'web' }).canal).toBe('instagram')
    expect(JSON.parse(rangement.get(CLE_SOURCE)!).canal).toBe('instagram')
  })

  it('lit l’arrivée notée par la page de présentation', () => {
    const rangement = new Map<string, string>([[CLE_ARRIVEE, JSON.stringify({ referent: 'android-app://com.google.android.youtube/', recherche: '' })]])
    const stockage = { getItem: (cle: string) => rangement.get(cle) ?? null, setItem: (cle: string, valeur: string) => { rangement.set(cle, valeur) } }
    expect(retenirSource(stockage, { recherche: '', referent: `https://${JEU}/motman/mots-fleches-en-duel/`, hoteDuJeu: JEU, plateforme: 'web' }).canal).toBe('youtube')
  })

  it('un stockage qui refuse d’écrire ne bloque rien', () => {
    const stockage = { getItem: () => null, setItem: () => { throw new Error('plein') } }
    expect(retenirSource(stockage, { recherche: '?src=yt', referent: '', hoteDuJeu: JEU, plateforme: 'web' }).canal).toBe('youtube')
  })
})
