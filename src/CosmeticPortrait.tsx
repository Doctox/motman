import { useEffect, useRef, useState } from 'react'
import { assetUrl } from './assetUrl'
import { frameClassName, getAnimation, getAvatar, getFrame, NO_ANIMATION_ID } from './cosmetics'
import './cosmetic-portrait.css'

export function CosmeticPortrait({ avatarId, frameId, animationId = NO_ANIMATION_ID, alt, className = 'mm-portrait', small = false }: {
  avatarId: string
  frameId: string
  animationId?: string
  alt: string
  className?: string
  small?: boolean
}) {
  const avatar = getAvatar(avatarId)
  const frame = getFrame(frameId)
  const animation = getAnimation(animationId)
  const portraitRef = useRef<HTMLSpanElement>(null)
  const [motionVisible, setMotionVisible] = useState(false)

  useEffect(() => {
    const element = portraitRef.current
    if (!element || (!animation.asset && !frame.asset)) return
    const visibleOnScreen = () => {
      if (document.visibilityState === 'hidden') return false
      const bounds = element.getBoundingClientRect()
      return bounds.bottom >= 0 && bounds.right >= 0 && bounds.top <= innerHeight && bounds.left <= innerWidth
    }
    const refresh = () => setMotionVisible(visibleOnScreen())
    if (!('IntersectionObserver' in window)) {
      refresh()
      document.addEventListener('visibilitychange', refresh)
      return () => document.removeEventListener('visibilitychange', refresh)
    }
    const observer = new IntersectionObserver(entries => {
      setMotionVisible(document.visibilityState !== 'hidden' && Boolean(entries[0]?.isIntersecting))
    })
    observer.observe(element)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [animation.asset, frame.asset])

  return <span ref={portraitRef} className={`${className} ${frameClassName(frameId)} ${frame.asset ? 'has-frame-art' : 'line-frame'} ${animation.asset ? 'has-avatar-animation' : ''} ${motionVisible ? 'is-cosmetic-visible' : ''} ${small ? 'small' : ''}`} data-frame={frameId} data-animation={animation.id}>
    <span className="cosmetic-avatar-clip">
      <img className="cosmetic-avatar-image" src={assetUrl(avatar.asset)} alt={alt} loading="lazy" decoding="async" />
    </span>
    {frame.asset ? <img className="cosmetic-frame-art" src={assetUrl(frame.asset)} alt="" aria-hidden="true" decoding="async" /> : null}
    {/* L'animation joue TOUJOURS, y compris sous `prefers-reduced-motion`.
        Un `<source media="(prefers-reduced-motion: reduce)">` la remplaçait
        auparavant par un poster fixe — sauf dans l'Épicerie, qui passait
        `previewAnimation` pour montrer l'article en mouvement. On voyait donc le
        dragon bouger avant l'achat et jamais après : difficile à défendre, et
        vécu comme une panne plutôt que comme un réglage.
        Sur un ornement acheté délibérément, l'envie du joueur
        l'emporte. La préférence système reste honorée là où elle protège
        vraiment — les secousses et pulsations du jeu (voir les règles
        `prefers-reduced-motion` de `styles/`), qui n'ont rien de décoratif. */}
    {animation.asset && motionVisible ? <picture className="cosmetic-avatar-animation" aria-hidden="true">
      <img src={assetUrl(animation.asset)} alt="" loading="lazy" decoding="async" fetchPriority="low" draggable={false} />
    </picture> : null}
  </span>
}
