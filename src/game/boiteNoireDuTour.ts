import { useEffect, useMemo, useRef } from 'react'
import type { MatchState } from '../matches'
import { serverNow } from '../serverClock'

// ─────────────────────────────────────────────────────────────────────────────
// LA BOÎTE NOIRE D'UN TOUR PERDU (04/11/2026).
//
// Le propriétaire, sur son téléphone : « ça me donnait mon tour puis ça passait à
// celui d'en face directement ». Trois fois le 03/11, le téléphone savait que c'était
// son tour, n'a envoyé aucune lettre, puis a fermé le tour à 00:00. Les journaux du
// serveur s'arrêtent là, et deux écrans Chrome ne le reproduisent pas.
//
// Ici, ce que seul le téléphone sait : l'appli était-elle visible, les touchers
// arrivaient-ils, l'image ou le fil principal étaient-ils figés, que disait l'écran.
// Le relevé ne part qu'avec l'envoi de 00:00 d'un tour sans lettre, en temps limité
// (match-api/boiteNoire.ts). Ni lettre, ni pseudo : des nombres et des repères.
//
// LE COMPTE DU PROPRIÉTAIRE SEULEMENT. Les textes légaux ne parlent que des rapports de
// plantage, et il ne garde pas de fichiers de joueurs. L'ouvrir à tous demanderait d'abord
// une phrase dans la politique de confidentialité et son accord.
//
// Une image demandée à la fois, au plus toutes les 250 ms : une boucle d'images en
// continu ferait travailler le GPU qu'on veut observer (motman-lag-android-gpu).
// ─────────────────────────────────────────────────────────────────────────────

const TIC_MS = 250

export type EcranDuTour = {
  /** Où en était le tour, en ms depuis son début. */
  aMs: number
  titre: 'lecture' | 'moi' | 'autre' | 'aucun'
  /** Les lettres du chevalet qu'on pouvait toucher, sur `total`. */
  actives: number
  total: number
  chrono: number | null
  attente: boolean
  /** Ce qui recevrait un toucher sur la première lettre : une fenêtre posée dessus se voit ici. */
  dessus: string
  resolution: boolean
  modale: boolean
}

export type BoiteNoire = {
  /** Où en était le tour quand l'écran a reçu la main : négatif, avant son début. */
  apprisMs: number
  /** La première image dessinée ensuite. */
  premiereImageMs: number | null
  ecartHorlogeMs: number
  /** Le plus long retard du fil principal. */
  filGeleMs: number
  /** La plus longue attente d'une image, et à quel moment du tour elle a commencé. */
  imageGeleeMs: number
  imageGeleeAMs: number | null
  cacheMs: number
  touchers: number
  surChevalet: number
  chevaletInactif: number
  surCase: number
  /** Les gestes que l'écran a refusés sans rien dire, par raison. */
  refus: Record<string, number>
  ecrans: EcranDuTour[]
}

function releverLEcran(aMs: number): EcranDuTour {
  const lettres = [...document.querySelectorAll<HTMLButtonElement>('.rack-letter')]
  const actives = lettres.filter(lettre => !lettre.disabled)
  const repere = actives[0] ?? lettres[0]
  const cadre = repere?.getBoundingClientRect()
  const dessus = cadre ? document.elementFromPoint(cadre.left + cadre.width / 2, cadre.top + cadre.height / 2) : null
  const entete = document.querySelector('.rack-heading')
  const chrono = document.querySelector('.turn-timer')?.textContent?.trim() ?? ''
  return {
    aMs,
    titre: !entete ? 'aucun' : entete.classList.contains('is-lecture') ? 'lecture' : entete.textContent?.startsWith('Tes lettres') ? 'moi' : 'autre',
    actives: actives.length,
    total: lettres.length,
    chrono: /^\d+$/.test(chrono) ? Number(chrono) : null,
    attente: Boolean(document.querySelector('.validate.is-waiting')),
    dessus: !repere ? 'sans-lettre' : dessus && repere.contains(dessus) ? 'lettre' : dessus?.classList[0]?.slice(0, 24) ?? dessus?.tagName ?? 'rien',
    resolution: Boolean(document.querySelector('.app-shell.is-resolving')),
    modale: Boolean(document.querySelector('.mm-modal-layer')),
  }
}

/** Le relevé du tour en cours, le mien et en temps limité seulement : un tour de 24 h n'a rien à dire ici. */
export function useBoiteNoireDuTour(match: MatchState | null, playerId: string, proprietaire: boolean) {
  const enCours = useRef<{ boite: BoiteNoire; resumer: () => BoiteNoire } | null>(null)
  const monTour = proprietaire && match?.status === 'active' && match.pace === 'realtime' && match.currentPlayerId === playerId ? match.turnNumber : null

  useEffect(() => {
    if (monTour === null || !match) return
    const debut = Date.parse(match.turnStartedAt)
    const aMs = () => Math.round(serverNow() - debut)
    const boite: BoiteNoire = {
      apprisMs: aMs(), premiereImageMs: null, ecartHorlogeMs: Math.round(serverNow() - Date.now()),
      filGeleMs: 0, imageGeleeMs: 0, imageGeleeAMs: null, cacheMs: 0,
      touchers: 0, surChevalet: 0, chevaletInactif: 0, surCase: 0, refus: {}, ecrans: [],
    }
    let dernierTic = performance.now()
    let cacheDepuis = document.hidden ? dernierTic : null
    let imageDemandee: number | null = null
    let image = 0

    const demanderUneImage = () => {
      if (imageDemandee !== null || document.hidden) return
      const demandee = performance.now()
      imageDemandee = demandee
      image = window.requestAnimationFrame(() => {
        imageDemandee = null
        const attente = Math.round(performance.now() - demandee)
        boite.premiereImageMs ??= aMs()
        if (attente > boite.imageGeleeMs) { boite.imageGeleeMs = attente; boite.imageGeleeAMs = aMs() - attente }
      })
    }
    const tic = window.setInterval(() => {
      const maintenant = performance.now()
      if (!document.hidden) boite.filGeleMs = Math.max(boite.filGeleMs, Math.round(maintenant - dernierTic - TIC_MS))
      dernierTic = maintenant
      demanderUneImage()
    }, TIC_MS)
    // Une appli en arrière-plan n'a ni images ni minuteurs : ce n'est pas un gel.
    const surVisibilite = () => {
      const maintenant = performance.now()
      if (document.hidden) {
        cacheDepuis = maintenant
        window.cancelAnimationFrame(image)
        imageDemandee = null
        return
      }
      if (cacheDepuis !== null) boite.cacheMs += maintenant - cacheDepuis
      cacheDepuis = null
      dernierTic = maintenant
    }
    const surToucher = (event: PointerEvent) => {
      boite.touchers += 1
      const cible = event.target instanceof Element ? event.target : null
      const lettre = cible?.closest<HTMLButtonElement>('.rack-letter')
      if (lettre) {
        if (lettre.disabled) boite.chevaletInactif += 1
        else boite.surChevalet += 1
      } else if (cible?.closest('[data-cell]')) boite.surCase += 1
    }
    window.addEventListener('pointerdown', surToucher, { capture: true, passive: true })
    document.addEventListener('visibilitychange', surVisibilite)
    const releves = [2_000, (Date.parse(match.turnEndsAt) - debut) / 2].map(apres => window.setTimeout(() => {
      boite.ecrans.push(releverLEcran(aMs()))
    }, Math.max(0, debut + apres - serverNow())))
    demanderUneImage()

    enCours.current = {
      boite,
      resumer: () => {
        const maintenant = performance.now()
        const imageAttendue = imageDemandee === null ? 0 : Math.round(maintenant - imageDemandee)
        const toujoursGelee = imageAttendue > boite.imageGeleeMs
        return {
          ...boite,
          cacheMs: Math.round(boite.cacheMs + (cacheDepuis === null ? 0 : maintenant - cacheDepuis)),
          imageGeleeMs: toujoursGelee ? imageAttendue : boite.imageGeleeMs,
          imageGeleeAMs: toujoursGelee ? aMs() - imageAttendue : boite.imageGeleeAMs,
          ecrans: [...boite.ecrans, releverLEcran(aMs())],
        }
      },
    }
    return () => {
      enCours.current = null
      window.clearInterval(tic)
      window.cancelAnimationFrame(image)
      releves.forEach(releve => window.clearTimeout(releve))
      window.removeEventListener('pointerdown', surToucher, { capture: true })
      document.removeEventListener('visibilitychange', surVisibilite)
    }
    // Un seul relevé par tour : les réponses reçues pendant le tour ne le recommencent pas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match?.id, monTour])

  return useMemo(() => ({
    refus: (raison: string) => {
      const boite = enCours.current?.boite
      if (boite) boite.refus[raison] = (boite.refus[raison] ?? 0) + 1
    },
    resumer: () => enCours.current?.resumer(),
  }), [])
}
