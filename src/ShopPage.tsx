import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, Check, Feather, PackageOpen, Palette, ShoppingBasket, Sparkles, User } from 'lucide-react'
import { assetUrl } from './assetUrl'
import {
  ANIMATIONS, AVATARS, BASKETS, FRAMES, avatarRarity,
  type CosmeticKind, type CosmeticReward, type PlayerCosmetics,
} from './cosmetics'
import { CosmeticPortrait } from './CosmeticPortrait'
import { equipServerCosmetic, openServerBasket, purchaseServerCosmetic } from './auth'
import { BASKET_DUPLICATE_REFUND_PERCENT } from './progressionRewards'
import { useDialogFocus } from './useDialogFocus'

type ShopTab = 'avatars' | 'frames' | 'animations' | 'baskets'
type BasketStageState = 'idle' | 'opening' | 'revealed'
/** Ce que le joueur s'apprête à payer : un article, ou l'ouverture d'un panier. */
type PendingPurchase = { kind: CosmeticKind | 'basket'; id: string; name: string; price: number }

const RARITY_LABELS = {
  commun: 'Normal', singulier: 'Singulier', rare: 'Rare', precieux: 'Précieux',
  exceptionnel: 'Exceptionnel', legendaire: 'Légendaire',
} as const

/** Le panier tremble, puis s'ouvre : assez long pour le suspense, pas pour l'ennui. */
const BASKET_SUSPENSE_MS = 1600

const ODDS_RARITIES = ['commun', 'singulier', 'rare', 'precieux', 'exceptionnel', 'legendaire'] as const
const AVATAR_FAMILIES = [
  { kind: 'human' as const, label: 'Humains', itemLabel: 'Humain' },
  { kind: 'animal' as const, label: 'Animaux', itemLabel: 'Animal' },
  { kind: 'object' as const, label: 'Objets', itemLabel: 'Objet' },
  { kind: 'flag' as const, label: 'Drapeaux', itemLabel: 'Drapeau' },
]

function formatProbability(value: number): string {
  if (value <= 0) return '—'
  return `${value.toLocaleString('fr-FR', { minimumFractionDigits: value < 1 ? 1 : 0, maximumFractionDigits: 1 })} %`
}

function Price({ value }: { value: number }) {
  return <span className="mm-price"><Feather />{value}</span>
}

function BasketArtwork({ state }: { state: BasketStageState }) {
  return <span className={`mm-basket-picture is-${state}`} aria-hidden="true">
    <img className="mm-basket-picture-closed" src={assetUrl('/assets/shop/basket-closed.webp')} alt="" draggable={false} />
    <img className="mm-basket-picture-open" src={assetUrl('/assets/shop/basket-open.webp')} alt="" draggable={false} />
  </span>
}

function BasketReward({ reward, cosmetics }: { reward: CosmeticReward; cosmetics: PlayerCosmetics }) {
  return <span className={`mm-basket-reward rarity-${reward.rarity} ${reward.duplicate ? 'is-duplicate' : ''}`} aria-live="polite">
    {reward.kind === 'avatar' && reward.asset ? <CosmeticPortrait avatarId={reward.id} frameId={cosmetics.equippedFrameId} alt={reward.name} />
      : reward.kind === 'frame' ? <CosmeticPortrait avatarId={cosmetics.equippedAvatarId} frameId={reward.id} animationId={cosmetics.equippedAnimationId} alt={reward.name} />
        : <CosmeticPortrait avatarId={cosmetics.equippedAvatarId} frameId={cosmetics.equippedFrameId} animationId={reward.id} alt={reward.name} />}
    <span><small>{RARITY_LABELS[reward.rarity]}</small><strong>{reward.name}</strong>
      {reward.duplicate ? <b className="mm-basket-duplicate">Déjà possédé · <Price value={reward.refund ?? 0} /> rendues</b> : <b className="mm-basket-new">Nouveau !</b>}
    </span>
  </span>
}

/**
 * Un tap sur un prix dépensait les plumes aussitôt, sans retour possible : un
 * doigt qui ripe en faisant défiler l'Épicerie suffisait. On demande donc
 * confirmation, en montrant le solde qui restera.
 */
export function PurchaseConfirm({ purchase, balance, preview, confirm, cancel }: {
  purchase: PendingPurchase
  balance: number
  /** Ce qu'on achète, tel qu'on le portera : c'est ce qui fait dire oui. */
  preview?: ReactNode
  confirm: () => void
  cancel: () => void
}) {
  const dialogRef = useDialogFocus<HTMLElement>(cancel)
  const manque = Math.max(0, purchase.price - balance)
  const verbe = purchase.kind === 'basket' ? 'Ouvrir' : 'Acheter'
  const plumes = (n: number) => `${n.toLocaleString('fr-FR')} plume${n > 1 ? 's' : ''}`
  // Rendue dans <body> : dans la page, l'en-tête et la barre du bas restaient
  // au-dessus du voile.
  return createPortal(<div className="mm-modal-layer mm-pause-layer" role="presentation" onClick={event => { if (event.target === event.currentTarget) cancel() }}>
    <section ref={dialogRef} className="mm-pause mm-purchase-confirm" role="dialog" aria-modal="true" aria-label={`${verbe} ${purchase.name}`} tabIndex={-1}>
      {preview ? <div className="mm-purchase-preview" aria-hidden="true">{preview}</div> : null}
      <h2>{verbe} « {purchase.name} » ?</h2>
      <p className="mm-purchase-cost"><Feather aria-hidden="true" /><b>{plumes(purchase.price)}</b></p>
      <p className="mm-purchase-balance">{manque > 0 ? `Il vous manque ${plumes(manque)}.` : `Il vous restera ${plumes(balance - purchase.price)}.`}</p>
      <button type="button" disabled={manque > 0} onClick={confirm}>{verbe}</button>
      <button type="button" className="secondary" data-dialog-autofocus onClick={cancel}>Annuler</button>
    </section>
  </div>, document.body)
}

export function ShopPage({ cosmetics, setCosmetics, back, notify }: {
  cosmetics: PlayerCosmetics
  setCosmetics: (cosmetics: PlayerCosmetics) => void
  back: () => void
  notify: (message: string) => void
}) {
  // Les paniers ouvrent l'Épicerie : c'est le rayon que le propriétaire veut
  // mettre en avant (14/09/2026).
  const [tab, setTab] = useState<ShopTab>('baskets')
  const [reward, setReward] = useState<CosmeticReward | null>(null)
  const [basketState, setBasketState] = useState<BasketStageState>('idle')
  const [pendingItem, setPendingItem] = useState('')
  const [purchase, setPurchase] = useState<PendingPurchase | null>(null)
  const basketTimerRef = useRef<number | null>(null)
  const purchasableAvatars = AVATARS.filter(avatar => avatar.availability === 'epicerie')
  const purchasableFrames = FRAMES.filter(frame => frame.availability === 'epicerie')
  const purchasableAnimations = ANIMATIONS.filter(animation => animation.availability === 'epicerie')

  useEffect(() => () => {
    if (basketTimerRef.current !== null) window.clearTimeout(basketTimerRef.current)
  }, [])

  const selectCosmetic = async (kind: CosmeticKind, id: string) => {
    if (pendingItem) return
    setPendingItem(`${kind}:${id}`)
    try {
      const owned = kind === 'avatar'
        ? cosmetics.ownedAvatarIds.includes(id)
        : kind === 'frame' ? cosmetics.ownedFrameIds.includes(id) : cosmetics.ownedAnimationIds.includes(id)
      const response = await (owned ? equipServerCosmetic(kind, id) : purchaseServerCosmetic(kind, id))
      if (!response.cosmetics) throw new Error('Collection serveur indisponible.')
      setCosmetics(response.cosmetics)
      notify(owned ? 'Style équipé' : 'Trouvaille ajoutée et équipée')
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : 'Achat impossible')
    } finally {
      setPendingItem('')
    }
  }

  /** Équiper un article possédé est gratuit et immédiat ; l'acheter se confirme. */
  const chooseCosmetic = (kind: CosmeticKind, id: string, name: string, price: number, owned: boolean) => {
    if (owned) void selectCosmetic(kind, id)
    else setPurchase({ kind, id, name, price })
  }

  const confirmPurchase = () => {
    if (!purchase) return
    setPurchase(null)
    if (purchase.kind === 'basket') void unwrapBasket(purchase.id)
    else void selectCosmetic(purchase.kind, purchase.id)
  }

  const unwrapBasket = async (basketId: string) => {
    if (basketState === 'opening') return
    if (basketState === 'revealed') {
      setReward(null)
      setBasketState('idle')
      return
    }
    setBasketState('opening')
    try {
      const remote = await openServerBasket(basketId)
      if (!remote.cosmetics || !remote.reward) throw new Error('Ouverture serveur incomplète.')
      setCosmetics(remote.cosmetics)
      setReward(remote.reward)
      basketTimerRef.current = window.setTimeout(() => {
        setBasketState('revealed')
        basketTimerRef.current = null
      }, BASKET_SUSPENSE_MS)
    } catch (reason) {
      setBasketState('idle')
      notify(reason instanceof Error ? reason.message : 'Ce panier ne peut pas être ouvert')
    }
  }

  return <div className="mm-page mm-shop-page">
    <section className="mm-shop-toolbar">
      <button type="button" onClick={back} aria-label="Retour au profil"><ArrowLeft /></button>
      <b><Feather />{cosmetics.plumes.toLocaleString('fr-FR')}</b>
    </section>
    <div className="mm-shop-tabs" role="tablist" aria-label="Rayons de L’Épicerie">
      <button type="button" role="tab" aria-selected={tab === 'baskets'} className={tab === 'baskets' ? 'active' : ''} onClick={() => setTab('baskets')}><ShoppingBasket />Paniers</button>
      <button type="button" role="tab" aria-selected={tab === 'avatars'} className={tab === 'avatars' ? 'active' : ''} onClick={() => setTab('avatars')}><User />Avatars</button>
      <button type="button" role="tab" aria-selected={tab === 'frames'} className={tab === 'frames' ? 'active' : ''} onClick={() => setTab('frames')}><Palette />Cadres</button>
      <button type="button" role="tab" aria-selected={tab === 'animations'} className={tab === 'animations' ? 'active' : ''} onClick={() => setTab('animations')}><Sparkles />Animations</button>
    </div>

    {tab === 'avatars' ? <div className="mm-avatar-shelves">
      {/* Une famille sans article en vente (les drapeaux avant leurs images) ne montre pas d'étagère vide. */}
      {AVATAR_FAMILIES.filter(family => purchasableAvatars.some(avatar => avatar.kind === family.kind)).map(family => <section className="mm-avatar-family" aria-label={`Avatars ${family.label.toLowerCase()}`} key={family.kind}>
        <header><h2>{family.label}</h2></header>
        <div className="mm-shop-grid">
          {purchasableAvatars.filter(avatar => avatar.kind === family.kind).map(avatar => {
            const owned = cosmetics.ownedAvatarIds.includes(avatar.id)
            const equipped = cosmetics.equippedAvatarId === avatar.id
            return <article className={`mm-shop-item rarity-${avatarRarity(avatar)} ${equipped ? 'is-equipped' : ''}`} key={avatar.id}>
              <CosmeticPortrait avatarId={avatar.id} frameId="cadre-ivoire" alt={avatar.name} />
              <small>{family.itemLabel}</small><strong>{avatar.name}</strong>
              <button type="button" disabled={equipped || Boolean(pendingItem)} onClick={() => chooseCosmetic('avatar', avatar.id, avatar.name, avatar.pricePlumes, owned)}>{equipped ? <><Check />Équipé</> : owned ? 'Équiper' : <Price value={avatar.pricePlumes} />}</button>
            </article>
          })}
        </div>
      </section>)}
    </div> : null}

    {tab === 'frames' ? <section className="mm-shop-grid mm-frame-shop" aria-label="Cadres">
      {purchasableFrames.map(frame => {
        const owned = cosmetics.ownedFrameIds.includes(frame.id)
        const equipped = cosmetics.equippedFrameId === frame.id
        return <article className={`mm-shop-item rarity-${frame.rarity} ${equipped ? 'is-equipped' : ''}`} key={frame.id}>
          <CosmeticPortrait avatarId={cosmetics.equippedAvatarId} frameId={frame.id} alt={frame.name} />
          <small>{RARITY_LABELS[frame.rarity]}</small><strong>{frame.name}</strong><p>{frame.description}</p>
          <button type="button" disabled={equipped || Boolean(pendingItem)} onClick={() => chooseCosmetic('frame', frame.id, frame.name, frame.pricePlumes, owned)}>{equipped ? <><Check />Équipé</> : owned ? 'Équiper' : <Price value={frame.pricePlumes} />}</button>
        </article>
      })}
    </section> : null}

    {tab === 'animations' ? <section className="mm-shop-grid mm-animation-shop" aria-label="Animations de portrait">
      {purchasableAnimations.map(animation => {
        const owned = cosmetics.ownedAnimationIds.includes(animation.id)
        const equipped = cosmetics.equippedAnimationId === animation.id
        return <article className={`mm-shop-item mm-animation-shop-item rarity-${animation.rarity} ${equipped ? 'is-equipped' : ''}`} key={animation.id}>
          <CosmeticPortrait avatarId={cosmetics.equippedAvatarId} frameId={cosmetics.equippedFrameId} animationId={animation.id} alt={animation.name} />
          <small>{RARITY_LABELS[animation.rarity]}</small><strong>{animation.name}</strong><p>{animation.description}</p>
          <button type="button" disabled={equipped || Boolean(pendingItem)} onClick={() => chooseCosmetic('animation', animation.id, animation.name, animation.pricePlumes, owned)}>{equipped ? <><Check />Équipée</> : owned ? 'Équiper' : <Price value={animation.pricePlumes} />}</button>
        </article>
      })}
    </section> : null}

    {tab === 'baskets' ? <section className="mm-basket-shelf" aria-label="Paniers">
      {BASKETS.map(basket => {
        // Le prix se voyait, le solde aussi, mais rien ne disait que l'un ne
        // couvrait pas l'autre : on tapait, et le serveur refusait. On le dit
        // AVANT (suggestion S-01, rapport 6766). Pendant l'ouverture et la
        // révélation, le bouton sert à autre chose : la règle ne s'applique
        // qu'au repos.
        const manque = Math.max(0, basket.pricePlumes - cosmetics.plumes)
        const inabordable = basketState === 'idle' && manque > 0
        return <article className={`mm-basket-card cloth-${basket.cloth} is-${basketState} ${basketState === 'revealed' && reward ? `reveals-${reward.rarity}` : ''}`} key={basket.id}>
        <header><small>Toute la collection · doubles remboursés à {BASKET_DUPLICATE_REFUND_PERCENT} %</small><strong>{basket.name}</strong><p>{basket.description}</p></header>
        <button className="mm-basket-stage" type="button" disabled={basketState === 'opening' || inabordable} onClick={() => basketState === 'idle' ? setPurchase({ kind: 'basket', id: basket.id, name: basket.name, price: basket.pricePlumes }) : void unwrapBasket(basket.id)} aria-label={basketState === 'revealed' ? 'Ranger la trouvaille dans la collection' : inabordable ? `${basket.name} : il vous manque ${manque} plumes` : `Ouvrir ${basket.name}`}>
          <span className="mm-basket-halo" aria-hidden="true" />
          <span className="mm-basket-burst" aria-hidden="true" />
          <span className="mm-feather-cloud" aria-hidden="true">{Array.from({ length: 14 }, (_, index) => <Feather key={index} />)}</span>
          <BasketArtwork state={basketState} />
          {reward ? <BasketReward reward={reward} cosmetics={cosmetics} /> : null}
          <span className="mm-basket-action">
            {basketState === 'opening' ? <><Sparkles />Le panier s’ouvre…</>
              : basketState === 'revealed' ? <><Check />Ranger la trouvaille</>
                : <><PackageOpen />Ouvrir <Price value={basket.pricePlumes} /></>}
          </span>
        </button>
        {inabordable ? <p className="mm-basket-manque" role="status">Il vous manque {manque} plume{manque > 1 ? 's' : ''} pour ouvrir ce panier.</p> : null}
        <em>{cosmetics.basketPity > 0 ? `Chance rare renforcée · palier ${cosmetics.basketPity}` : 'Chance rare initiale'}</em>
        <details className="mm-basket-odds">
          <summary>Probabilités de ce panier</summary>
          <div>{ODDS_RARITIES.map(rarity => <span key={rarity}><i className={`rarity-${rarity}`} />{RARITY_LABELS[rarity]}<b>{formatProbability(cosmetics.basketOdds[rarity])}</b></span>)}</div>
          <small>Les chances sont recalculées selon votre collection et le palier actuel.</small>
        </details>
      </article>
      })}
      <small className="mm-shop-note"><Sparkles />Les paniers ne contiennent ni titre ni avantage de jeu.</small>
    </section> : null}
    {purchase ? <PurchaseConfirm
      purchase={purchase}
      balance={cosmetics.plumes}
      preview={purchase.kind === 'basket'
        ? <BasketArtwork state="idle" />
        : <CosmeticPortrait
          avatarId={purchase.kind === 'avatar' ? purchase.id : cosmetics.equippedAvatarId}
          frameId={purchase.kind === 'frame' ? purchase.id : cosmetics.equippedFrameId}
          animationId={purchase.kind === 'animation' ? purchase.id : cosmetics.equippedAnimationId}
          alt="" />}
      confirm={confirmPurchase}
      cancel={() => setPurchase(null)} /> : null}
  </div>
}
