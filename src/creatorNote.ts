// LE MOT DU CRÉATEUR (11/10/2026).
//
// À la première ouverture de la journée, le propriétaire explique qu'il fait
// MotMan seul et paie les serveurs lui-même, et propose de suivre le Studio
// Doctox sur Instagram et TikTok pour faire connaître le jeu. Une fois par jour
// et par appareil, jamais plus : la journée est celle de Paris, comme le défi.
//
// Le souvenir vit dans le stockage local, et rien d'autre : ce n'est qu'une
// politesse, pas un état qu'un autre appareil ou le serveur aurait à connaître.
// Stockage indisponible (navigation privée, données effacées) : le message
// paraît, puis ne revient pas avant le prochain lancement.

export const INSTAGRAM_STUDIO = 'https://www.instagram.com/studiodoctox/'
export const TIKTOK_STUDIO = 'https://www.tiktok.com/@studiodoctox'

const CLE = 'motman:mot-du-createur'

type Stockage = Pick<Storage, 'getItem' | 'setItem'>

function stockageLocal(): Stockage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** Le message n'a pas encore été montré ce jour-là (clé `AAAA-MM-JJ`, Paris). */
export function motDuCreateurAMontrer(jour: string, stockage: Stockage | null = stockageLocal()): boolean {
  try {
    return stockage?.getItem(CLE) !== jour
  } catch {
    return true
  }
}

export function motDuCreateurMontre(jour: string, stockage: Stockage | null = stockageLocal()): void {
  try {
    stockage?.setItem(CLE, jour)
  } catch {
    // Rien à faire : au pire, il reparaîtra au prochain lancement.
  }
}
