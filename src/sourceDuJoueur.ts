// ─────────────────────────────────────────────────────────────────────────────
// D'OÙ VIENNENT LES JOUEURS (17/10/2026)
//
// Demande du propriétaire : savoir si un nouveau joueur arrive de Google, du
// Play Store, d'Instagram, de TikTok ou de YouTube. Il a choisi la version
// AUTOMATIQUE : aucune question posée au joueur, aucun écran de plus.
//
// TROIS INDICES, dans cet ordre :
//   1. le LIEN MARQUÉ : `doctox.fr/motman/?src=instagram` dans une bio, une
//      vidéo, une story. C'est le seul indice sûr pour les réseaux : leurs
//      navigateurs intégrés cachent souvent d'où l'on vient ;
//   2. la PAGE PRÉCÉDENTE (`document.referrer`) : Google et les autres moteurs,
//      un réseau qui la laisse passer, ou un autre site ;
//   3. l'APPLI ANDROID sans autre indice : elle vient du Play Store.
// Sinon, « site » : adresse tapée, favori, ou rien de lisible.
//
// LE PREMIER INDICE GAGNE, une fois pour toutes sur cet appareil : un joueur
// revenu par son favori reste venu d'Instagram. La page de présentation, où
// l'on arrive souvent de Google avant de cliquer « Jouer », note l'arrivée
// pour la page du jeu (`motman-arrivee-v1`, public/mots-fleches-en-duel/).
//
// Le serveur ne retient la source que pour un compte créé depuis moins d'un
// jour (account-api) : les joueurs d'avant cette version ne passent pas tous
// pour des « favoris ». Il ne garde que le canal et le nom du site d'où l'on
// vient — jamais l'adresse complète, jamais rien de montré aux autres joueurs.
// ─────────────────────────────────────────────────────────────────────────────

export type Plateforme = 'web' | 'android' | 'ios'
export type SourceDuJoueur = { canal: string; hote: string | null; plateforme: Plateforme }

export const CLE_SOURCE = 'motman-source-v1'
/** Posée par la page de présentation : l'arrivée brute, avant le clic sur « Jouer ». */
export const CLE_ARRIVEE = 'motman-arrivee-v1'

/** Les surnoms d'un lien marqué. Un marqueur inconnu reste lisible : « lien-<marqueur> ». */
const ALIAS: Record<string, string> = {
  instagram: 'instagram', insta: 'instagram', ig: 'instagram',
  tiktok: 'tiktok', tt: 'tiktok',
  youtube: 'youtube', yt: 'youtube', shorts: 'youtube',
  facebook: 'facebook', fb: 'facebook',
  google: 'google',
  playstore: 'play-store', 'play-store': 'play-store', play: 'play-store',
  // Les liens que les joueurs partagent eux-mêmes (src/dailyShare.ts, 23/10/2026).
  partage: 'partage', ami: 'ami',
}

/** Le canal d'un lien marqué (`?src=` ou `?utm_source=`), ou `null` s'il n'y en a pas. */
export function canalDuLien(recherche: string): string | null {
  const params = new URLSearchParams(recherche)
  const brut = (params.get('src') ?? params.get('utm_source') ?? '').trim().toLowerCase()
  if (!brut) return null
  if (ALIAS[brut]) return ALIAS[brut]
  const propre = brut.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24)
  return propre ? `lien-${propre}` : null
}

const MOTEURS = ['bing.com', 'duckduckgo.com', 'qwant.com', 'ecosia.org', 'yahoo.com', 'startpage.com', 'search.brave.com', 'yandex.com', 'lilo.org']
const SITES: Array<[string, string]> = [
  ['instagram.com', 'instagram'],
  ['tiktok.com', 'tiktok'],
  ['youtube.com', 'youtube'],
  ['youtu.be', 'youtube'],
  ['facebook.com', 'facebook'],
  ['fb.com', 'facebook'],
  ['play.google.com', 'play-store'],
]
/** Les applis qui se nomment elles-mêmes (`android-app://…`) quand elles ouvrent un lien. */
const APPLIS: Record<string, string> = {
  'com.instagram.android': 'instagram',
  'com.zhiliaoapp.musically': 'tiktok',
  'com.ss.android.ugc.trill': 'tiktok',
  'com.google.android.youtube': 'youtube',
  'com.facebook.katana': 'facebook',
  'com.facebook.orca': 'facebook',
  'com.google.android.googlequicksearchbox': 'google',
}

const estDe = (hote: string, domaine: string) => hote === domaine || hote.endsWith(`.${domaine}`)

/**
 * Le canal de la page précédente. `null` quand il n'y en a pas, ou quand elle
 * est de MotMan même : ce n'est pas une arrivée.
 */
export function canalDuReferent(referent: string, hoteDuJeu: string): { canal: string; hote: string | null } | null {
  if (!referent) return null
  let adresse: URL
  try { adresse = new URL(referent) } catch { return null }
  if (adresse.protocol === 'android-app:') {
    const appli = adresse.hostname.toLowerCase()
    return { canal: APPLIS[appli] ?? 'autre', hote: appli.slice(0, 100) }
  }
  const hote = adresse.hostname.toLowerCase().replace(/^www\./, '')
  if (!hote) return null
  const jeu = hoteDuJeu.toLowerCase().replace(/^www\./, '')
  if (hote === jeu) return null
  // Le retour d'une connexion (compte Google, lien d'e-mail) n'est pas une arrivée.
  if (estDe(hote, 'accounts.google.com') || estDe(hote, 'supabase.co')) return null
  if (/(^|\.)google\.[a-z.]+$/.test(hote) && !estDe(hote, 'play.google.com')) return { canal: 'google', hote }
  if (MOTEURS.some(moteur => estDe(hote, moteur))) return { canal: 'recherche', hote }
  const site = SITES.find(([domaine]) => estDe(hote, domaine))
  return { canal: site ? site[1] : 'autre', hote: hote.slice(0, 100) }
}

export type Indices = {
  recherche: string
  referent: string
  hoteDuJeu: string
  plateforme: Plateforme
  /** L'arrivée notée par la page de présentation, s'il y en a une. */
  arrivee?: { recherche?: string; referent?: string } | null
}

/** La source d'après les indices du moment. Pur. */
export function determinerSource({ recherche, referent, hoteDuJeu, plateforme, arrivee }: Indices): SourceDuJoueur {
  const lien = canalDuLien(recherche) ?? (arrivee?.recherche ? canalDuLien(arrivee.recherche) : null)
  const page = canalDuReferent(referent, hoteDuJeu) ?? (arrivee?.referent ? canalDuReferent(arrivee.referent, hoteDuJeu) : null)
  if (lien) return { canal: lien, hote: page?.hote ?? null, plateforme }
  if (page) return { ...page, plateforme }
  return { canal: plateforme === 'android' ? 'play-store' : plateforme === 'ios' ? 'app-store' : 'site', hote: null, plateforme }
}

type Rangement = Pick<Storage, 'getItem' | 'setItem'>

function lire<T>(rangement: Rangement, cle: string): T | null {
  try {
    const brut = rangement.getItem(cle)
    return brut ? JSON.parse(brut) as T : null
  } catch {
    return null
  }
}

/**
 * La source retenue pour cet appareil : la première jamais vue, sinon celle
 * d'aujourd'hui, notée pour la suite. Le stockage peut manquer (navigation
 * privée) : la source du moment sert alors pour cette visite.
 */
export function retenirSource(rangement: Rangement, indices: Omit<Indices, 'arrivee'>): SourceDuJoueur {
  const deja = lire<SourceDuJoueur>(rangement, CLE_SOURCE)
  if (deja && typeof deja.canal === 'string') return deja
  const source = determinerSource({ ...indices, arrivee: lire(rangement, CLE_ARRIVEE) })
  try { rangement.setItem(CLE_SOURCE, JSON.stringify(source)) } catch { /* stockage indisponible */ }
  return source
}

let sourceDeCetteVisite: SourceDuJoueur | null = null

/**
 * À appeler au lancement, AVANT toute navigation interne : la page précédente
 * et le lien marqué ne se lisent qu'à l'arrivée. Le marqueur est ensuite retiré
 * de la barre d'adresse, pour qu'une adresse partagée ne le transmette pas.
 */
export function noterLaSourceAuLancement(natif: boolean, plateformeNative: Plateforme = 'android'): SourceDuJoueur {
  const plateforme: Plateforme = natif ? plateformeNative : 'web'
  const indices = { recherche: location.search, referent: document.referrer, hoteDuJeu: location.hostname, plateforme }
  try {
    sourceDeCetteVisite = retenirSource(localStorage, indices)
  } catch {
    sourceDeCetteVisite = determinerSource(indices)
  }
  const params = new URLSearchParams(location.search)
  if (params.has('src') || params.has('utm_source')) {
    for (const cle of [...params.keys()]) if (cle === 'src' || cle.startsWith('utm_')) params.delete(cle)
    const reste = params.toString()
    history.replaceState(history.state, '', `${location.pathname}${reste ? `?${reste}` : ''}${location.hash}`)
  }
  return sourceDeCetteVisite
}

/** La source à joindre à la création du compte (auth.ts), si le lancement l'a notée. */
export function sourceDuJoueur(): SourceDuJoueur | null {
  return sourceDeCetteVisite
}
