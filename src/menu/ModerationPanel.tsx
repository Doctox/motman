import { useEffect, useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import { loadModerationQueue, resolveReport, type ModerationDecision, type ModerationReport } from '../social'
import { useDialogFocus } from '../useDialogFocus'
import './menu-moderation.css'

// ─────────────────────────────────────────────────────────────────────────────
// LES SIGNALEMENTS, EN CLAIR ET DANS L'APPLI (21/09/2026)
//
// « Si je fais un signalement d'un joueur il va où ? J'ai signalé ma femme
// hier, j'ai aucun retour. » Il avait raison de râler : l'API de modération
// existait depuis des mois, mais AUCUN écran ne l'appelait. Les signalements
// dormaient en base, annoncés sur une issue GitHub qu'il n'ouvre jamais — le
// sien a attendu quatorze heures.
//
// TROIS DÉCISIONS, PAS QUATRE. Le serveur accepte aussi `warn`, mais rien
// n'envoie d'avertissement au joueur : le bouton aurait menti. Tant que
// l'avertissement n'existe pas, il n'est pas proposé.
//
// UNE CONFIRMATION POUR CE QUI FAIT MAL. Suspendre ou bannir coupe l'accès à
// quelqu'un ; sur un téléphone, ça se touche par erreur. Le premier appui
// demande, le second agit.
// ─────────────────────────────────────────────────────────────────────────────

/** Depuis combien de temps un signalement attend, dit comme on le dirait. */
export function attenteEnClair(depuis: string, maintenant = Date.now()): string {
  const ecart = maintenant - new Date(depuis).getTime()
  if (!Number.isFinite(ecart) || ecart < 0) return 'à l’instant'
  const heures = Math.floor(ecart / 3_600_000)
  if (heures < 1) return 'à l’instant'
  if (heures < 24) return `il y a ${heures} h`
  const jours = Math.floor(heures / 24)
  return jours === 1 ? 'il y a 1 jour' : `il y a ${jours} jours`
}

const MOTIFS: Record<string, string> = {
  pseudo: 'Pseudo déplacé',
  comportement: 'Comportement',
  triche: 'Triche',
  harcelement: 'Harcèlement',
  autre: 'Autre',
}

/**
 * `charger` et `trancher` sont injectables pour que l'écran puisse être montré
 * au propriétaire — et tenu par un test — sans session ni réseau. Par défaut,
 * ce sont les vraies routes.
 */
export function ModerationPanel({ fermer, charger = loadModerationQueue, trancher = resolveReport }: {
  fermer: () => void
  charger?: () => Promise<ModerationReport[]>
  trancher?: (reportId: string, decision: ModerationDecision) => Promise<void>
}) {
  const dialogRef = useDialogFocus<HTMLDivElement>(fermer)
  const [file, setFile] = useState<ModerationReport[] | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [enCours, setEnCours] = useState<string | null>(null)
  const [aConfirmer, setAConfirmer] = useState<string | null>(null)

  useEffect(() => {
    let vivant = true
    charger()
      .then(lignes => { if (vivant) setFile(lignes) })
      .catch(raison => { if (vivant) setErreur(raison instanceof Error ? raison.message : 'Liste indisponible.') })
    return () => { vivant = false }
  }, [charger])

  const decider = async (report: ModerationReport, decision: ModerationDecision) => {
    const cle = `${report.id}:${decision}`
    if (decision !== 'dismiss' && aConfirmer !== cle) { setAConfirmer(cle); return }
    setEnCours(report.id); setErreur(null); setAConfirmer(null)
    try {
      await trancher(report.id, decision)
      // Traité : il quitte la liste. Le compteur du pouls se remet à jour à la
      // prochaine lecture — inutile de rappeler le serveur pour un nombre.
      setFile(lignes => (lignes ?? []).filter(ligne => ligne.id !== report.id))
    } catch (raison) {
      setErreur(raison instanceof Error ? raison.message : 'Décision impossible.')
    } finally { setEnCours(null) }
  }

  return (
    <div className="mm-modal-layer mm-moderation-layer" role="presentation" onMouseDown={event => event.target === event.currentTarget && fermer()}>
      <div ref={dialogRef} className="mm-moderation" role="dialog" aria-modal="true" aria-labelledby="moderation-title" tabIndex={-1}>
        <h2 id="moderation-title"><ShieldAlert aria-hidden="true" />Signalements</h2>

        {erreur ? <p className="mm-moderation-erreur" role="alert">{erreur}</p> : null}
        {file === null && !erreur ? <p className="mm-moderation-vide">Lecture des signalements…</p> : null}
        {file?.length === 0 ? <p className="mm-moderation-vide">Rien à traiter. Tout est à jour.</p> : null}

        {(file ?? []).map(report => (
          <article key={report.id} className="mm-moderation-fiche">
            <header>
              <strong>{MOTIFS[report.reason] ?? report.reason}</strong>
              <time dateTime={report.created_at}>{attenteEnClair(report.created_at)}</time>
            </header>
            <p className="mm-moderation-qui">
              <b>{report.reporterName}</b> a signalé <b>{report.reportedName}</b>
            </p>
            {report.details ? <blockquote>{report.details}</blockquote> : <p className="mm-moderation-vide">Sans commentaire.</p>}
            <div className="mm-moderation-actions">
              <button type="button" disabled={enCours === report.id} onClick={() => decider(report, 'dismiss')}>
                Sans suite
              </button>
              <button
                type="button"
                className="mm-moderation-dur"
                disabled={enCours === report.id}
                onClick={() => decider(report, 'suspend')}
              >
                {aConfirmer === `${report.id}:suspend` ? 'Confirmer ?' : 'Suspendre'}
              </button>
              <button
                type="button"
                className="mm-moderation-dur"
                disabled={enCours === report.id}
                onClick={() => decider(report, 'ban')}
              >
                {aConfirmer === `${report.id}:ban` ? 'Confirmer ?' : 'Bannir'}
              </button>
            </div>
          </article>
        ))}

        <button type="button" className="mm-moderation-fermer" data-dialog-autofocus onClick={fermer}>Fermer</button>
      </div>
    </div>
  )
}
