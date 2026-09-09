import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { startAdaptivePolling } from './adaptivePolling'
import type { GridDifficulty } from './generator'
import { subscribeToMenuUpdates, type MenuRealtimeStatus, type MenuWakeupScope } from './menuRealtime'
import { createSoloMatch, forfeitMatch, type MatchPace } from './matches'
import { loadPlayerIdentity, type GuestIdentity } from './playerIdentity'
import { RankedReadyOverlay } from './RankedReadyOverlay'
import { RequiredAppUpdateScreen } from './RequiredAppUpdate'
import { requiredUpdateFromPayload, type RequiredAppUpdate } from './appUpdate'
import {
  cancelRankedSearch,
  EMPTY_RANKED_MATCHMAKING,
  loadRankedMatchmaking,
  respondToRankedReady,
  signalRankedSearchExit,
  startRankedSearch,
  type RankedMatchmakingState,
} from './rankedMatchmaking'
import { useRankedSearchExpiry } from './rankedSearchExpiry'
import { useSacrificedMatch } from './sacrificedMatch'

const MenuApp = lazy(() => import('./Menu').then(module => ({ default: module.MenuApp })))
const MultiplayerGameScreen = lazy(() => import('./MultiplayerGame').then(module => ({ default: module.MultiplayerGameScreen })))

function AppLoading({ label = 'Préparation de MotMan…' }: { label?: string }) {
  return <main className="app-loading" role="status"><LoaderCircle /><span>{label}</span></main>
}

export function App({ initialRequiredUpdate = null }: { initialRequiredUpdate?: RequiredAppUpdate | null }) {
  const [requiredUpdate, setRequiredUpdate] = useState<RequiredAppUpdate | null>(initialRequiredUpdate)
  const [matchId, setMatchId] = useState<string | null>(() => {
    const match = location.hash.match(/^#partie=([^&]+)$/)
    return match ? decodeURIComponent(match[1]) : null
  })
  const [ranked, setRanked] = useState<RankedMatchmakingState>(EMPTY_RANKED_MATCHMAKING)
  const [rankedBusy, setRankedBusy] = useState(false)
  const [rankedError, setRankedError] = useState<string | null>(null)
  // Vrai après une recherche restée sans adversaire : l'écran de jeu s'en sert
  // pour dire pourquoi elle s'est arrêtée. Purement local — le serveur n'a pas
  // à connaître cet état.
  const [rankedTimedOut, setRankedTimedOut] = useState(false)
  const [playerId, setPlayerId] = useState(() => loadPlayerIdentity().playerId)
  const rankedRef = useRef(ranked)
  const rankedPollingRef = useRef<ReturnType<typeof startAdaptivePolling> | null>(null)
  rankedRef.current = ranked

  // Rythme de la partie ouverte à l'écran, remonté par l'écran de jeu — `App` ne
  // connaît sinon que son identifiant.
  const [openMatchPace, setOpenMatchPace] = useState<MatchPace | null>(null)

  // Partie qui sera PERDUE si le joueur rejoint le match classé proposé. Le
  // détail — et surtout pourquoi seul le TEMPS LIMITÉ est concerné — vit dans
  // `sacrificedMatch.ts`, avec le banc qui l'y tient (`.test.ts`).
  const { reclamer: reclamerSacrifice } = useSacrificedMatch({
    readyId: ranked.ready?.id ?? null,
    readyPausedMatchId: ranked.ready?.pausedMatchId ?? null,
    currentMatchId: matchId,
    pace: openMatchPace,
  })

  useEffect(() => {
    const requireUpdate = (event: Event) => {
      const parsed = requiredUpdateFromPayload((event as CustomEvent<unknown>).detail)
      if (parsed) setRequiredUpdate(parsed)
    }
    window.addEventListener('motman:update-required', requireUpdate)
    return () => window.removeEventListener('motman:update-required', requireUpdate)
  }, [])

  const openMatch = useCallback((nextMatchId: string) => {
    history.replaceState(null, '', `#partie=${encodeURIComponent(nextMatchId)}`)
    setMatchId(nextMatchId)
  }, [])
  const exitMatch = useCallback(() => {
    history.replaceState(null, '', '#jouer')
    setMatchId(null)
  }, [])
  const returnHome = useCallback(() => {
    history.replaceState(null, '', '#accueil')
    setMatchId(null)
  }, [])
  const startSolo = useCallback(async (difficulty: GridDifficulty, pace: MatchPace) => {
    const match = await createSoloMatch(difficulty, pace)
    openMatch(match.id)
  }, [openMatch])

  // Entrée dans un match classé : on solde la partie sacrifiée.
  // Sans ça elle restait `active` et mourait par timeout trois tours plus tard —
  // le joueur voyait une défaite surgir sans comprendre d'où elle venait. Le
  // barème ne change pas (un abandon ne rapporte rien, cf. `playerOutcome`),
  // c'est la lisibilité qui change.
  //
  // L'abandon part SANS ÊTRE ATTENDU, et l'arène s'ouvre dans la foulée. Il a
  // été écrit avec un `await` d'abord, ce qui contredisait son propre principe :
  // sur un réseau lent, le joueur restait devant l'écran de confirmation pendant
  // que l'adversaire, lui, était déjà dans l'arène et voyait tourner son
  // chronomètre. Rien ici ne conditionne l'ouverture du match classé — l'abandon
  // ne renvoie aucune donnée dont on ait besoin, et son échec n'est de toute
  // façon que journalisé. Cette fonction n'a donc plus rien d'asynchrone.
  const enterRankedMatch = useCallback((nextMatchId: string) => {
    const sacrifice = reclamerSacrifice(nextMatchId)
    if (sacrifice) {
      void forfeitMatch(playerId, sacrifice)
        .catch(reason => console.error('Clôture de la partie interrompue impossible', reason))
    }
    openMatch(nextMatchId)
  }, [openMatch, playerId, reclamerSacrifice])

  useEffect(() => {
    const syncIdentity = (event: Event) => {
      const next = (event as CustomEvent<GuestIdentity>).detail
      if (next?.playerId) setPlayerId(next.playerId)
    }
    window.addEventListener('motman:identity', syncIdentity)
    return () => window.removeEventListener('motman:identity', syncIdentity)
  }, [])

  // Sortie de la file classée quand le joueur ferme vraiment la page.
  //
  // `pagehide` et NON `visibilitychange` : passer en arrière-plan n'est pas
  // partir. Le sondage continue d'ailleurs toutes les 15 s quand l'application
  // est cachée (voir plus bas) — l'intention est bien qu'une recherche survive à
  // un aller-retour vers une notification. Annuler sur l'arrière-plan tuerait
  // des recherches légitimes.
  //
  // Seul l'état `searching` est concerné : une confirmation déjà engagée
  // (`ready`, `accepted`) a son propre cycle de vie côté serveur.
  //
  // Ce signal ne remplace rien : sur Android, un balayage vers le haut
  // n'exécute aucun JavaScript. Le filet reste le filtre de fraîcheur serveur.
  useEffect(() => {
    const quitter = () => {
      if (rankedRef.current.status === 'searching') signalRankedSearchExit()
    }
    window.addEventListener('pagehide', quitter)
    return () => window.removeEventListener('pagehide', quitter)
  }, [])

  useEffect(() => {
    let active = true
    const polling = startAdaptivePolling({
      task: async () => {
        try {
          const next = await loadRankedMatchmaking()
          if (!active) return
          setRanked(next)
          setRankedError(null)
          if (next.status === 'started' && next.matchId && next.matchId !== matchId) enterRankedMatch(next.matchId)
        } catch {
          // A guest without a remote session can still browse the local menu.
        }
      },
      delay: visibility => {
        const status = rankedRef.current.status
        if (status === 'ready' || status === 'accepted') return visibility === 'hidden' ? 3_000 : 2_000
        if (status === 'searching') return visibility === 'hidden' ? 15_000 : 8_000
        return visibility === 'hidden' ? 60_000 : 20_000
      },
    })
    rankedPollingRef.current = polling
    return () => {
      active = false
      if (rankedPollingRef.current === polling) rankedPollingRef.current = null
      polling.stop()
    }
  }, [enterRankedMatch, matchId])

  useEffect(() => subscribeToMenuUpdates(playerId, scope => {
    window.dispatchEvent(new CustomEvent('motman:menu-wakeup', {
      detail: { scope, status: 'connected' satisfies MenuRealtimeStatus },
    }))
    rankedPollingRef.current?.wake()
  }, status => {
    window.dispatchEvent(new CustomEvent('motman:menu-wakeup', {
      detail: { scope: 'all' satisfies MenuWakeupScope, status },
    }))
    if (status === 'connected') rankedPollingRef.current?.wake()
  }), [playerId])

  // Recherche restée sans adversaire : on la solde et on garde de quoi le dire.
  // Le détail — et surtout POURQUOI le garde-fou est un `ref` — vit dans
  // `rankedSearchExpiry.ts`, avec le banc qui l'y tient (`.test.ts`).
  const { autoriserANouveau: rouvrirExpiration } = useRankedSearchExpiry({
    ranked,
    busy: rankedBusy,
    setBusy: setRankedBusy,
    onCancelled: setRanked,
    onTimedOut: () => setRankedTimedOut(true),
  })

  const beginRankedSearch = useCallback(async () => {
    if (rankedBusy) return
    setRankedBusy(true)
    setRankedError(null)
    setRankedTimedOut(false)
    // Un nouveau départ rouvre le droit d'expirer : c'est le seul endroit qui
    // relâche le garde-fou (voir `rankedSearchExpiry.ts`).
    rouvrirExpiration()
    try { setRanked(await startRankedSearch()) }
    catch (reason) { setRankedError(reason instanceof Error ? reason.message : 'Recherche classée impossible.') }
    finally { setRankedBusy(false) }
  }, [rankedBusy, rouvrirExpiration])

  const stopRankedSearch = useCallback(async () => {
    if (rankedBusy) return
    setRankedBusy(true)
    setRankedError(null)
    setRankedTimedOut(false)
    try { setRanked(await cancelRankedSearch()) }
    catch (reason) { setRankedError(reason instanceof Error ? reason.message : 'Annulation impossible.') }
    finally { setRankedBusy(false) }
  }, [rankedBusy])

  const answerRankedReady = useCallback(async (decision: 'accept' | 'decline') => {
    const ready = rankedRef.current.ready
    if (!ready || rankedBusy) return
    setRankedBusy(true)
    setRankedError(null)
    try {
      const next = await respondToRankedReady(ready.id, decision)
      setRanked(next)
      if (next.status === 'started' && next.matchId) enterRankedMatch(next.matchId)
    } catch (reason) {
      setRankedError(reason instanceof Error ? reason.message : 'Réponse classée impossible.')
    } finally {
      setRankedBusy(false)
    }
  }, [enterRankedMatch, rankedBusy])

  if (requiredUpdate) return <RequiredAppUpdateScreen update={requiredUpdate} />

  return <>
    {matchId ? <Suspense fallback={<AppLoading label="Préparation du duel…" />}>
      <MultiplayerGameScreen matchId={matchId} onExit={exitMatch} onHome={returnHome} onPaceChange={setOpenMatchPace} />
    </Suspense> : <Suspense fallback={<AppLoading />}>
      <MenuApp
        onStartSolo={startSolo}
        onStartMatch={openMatch}
        ranked={ranked}
        rankedBusy={rankedBusy}
        rankedTimedOut={rankedTimedOut}
        rankedError={rankedError}
        startRanked={beginRankedSearch}
        cancelRanked={stopRankedSearch}
      />
    </Suspense>}
    <RankedReadyOverlay
      state={ranked}
      currentMatchId={matchId}
      currentMatchPace={openMatchPace}
      busy={rankedBusy}
      error={rankedError}
      accept={() => void answerRankedReady('accept')}
      decline={() => void answerRankedReady('decline')}
    />
  </>
}
