import { useEffect, useState } from 'react'
import { Check, Share2 } from 'lucide-react'
import { shareText, type ShareOutcome } from '../dailyShare'

const MESSAGES: Record<ShareOutcome, string | null> = {
  shared: null,
  cancelled: null,
  copied: 'Résultat copié : colle-le dans une conversation.',
  failed: 'Le partage n’a pas fonctionné sur cet appareil.',
}

/**
 * Bouton « Partager mon résultat » du défi du jour. Le texte vient de
 * dailyShare.ts. En version compacte (carte de l'accueil), le retour tient dans
 * le bouton lui-même : il n'y a pas la place d'une ligne en dessous.
 */
export function DailyShareButton({ text, compact = false }: { text: string; compact?: boolean }) {
  const [issue, setIssue] = useState<ShareOutcome | null>(null)
  useEffect(() => {
    if (issue !== 'copied') return
    const timer = window.setTimeout(() => setIssue(null), 2500)
    return () => window.clearTimeout(timer)
  }, [issue])
  const partager = async () => setIssue(await shareText(text))
  const copie = issue === 'copied'
  return <div className={`mm-daily-share ${compact ? 'is-compact' : ''}`}>
    <button type="button" onClick={() => void partager()}>
      {copie ? <Check aria-hidden="true" /> : <Share2 aria-hidden="true" />}
      {compact ? copie ? 'Copié !' : 'Partager' : 'Partager mon résultat'}
    </button>
    <p role="status" className={compact ? 'mm-visually-hidden' : ''}>{issue ? MESSAGES[issue] : null}</p>
  </div>
}
