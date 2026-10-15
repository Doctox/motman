import { useState, type ReactNode } from 'react'
import { Sparkles } from 'lucide-react'
import { marquerPremierPassageVu, premierPassageAMontrer, type PremierPassage } from '../premiersPassages'
import './menu-premier-passage.css'

/**
 * La carte de premier passage (15/10/2026) : ce que le guide de départ ne dit
 * plus, dit une fois, à l'endroit où ça sert. Elle ne bloque rien et disparaît
 * pour de bon à « Compris ». Voir `src/premiersPassages.ts`.
 */
export function PremierPassageCarte({ lieu, titre, children }: { lieu: PremierPassage; titre: string; children: ReactNode }) {
  const [visible, setVisible] = useState(() => premierPassageAMontrer(lieu))
  if (!visible) return null
  return <aside className="mm-premier-passage" aria-label={titre}>
    <Sparkles aria-hidden="true" />
    <div>
      <strong>{titre}</strong>
      <p>{children}</p>
    </div>
    <button type="button" onClick={() => { marquerPremierPassageVu(lieu); setVisible(false) }}>Compris</button>
  </aside>
}
