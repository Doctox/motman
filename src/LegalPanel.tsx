import { useState } from 'react'
import { BookOpen, Copy, FileText, Info, MessageSquareText, Paperclip, Scale, Send, ShieldCheck, X } from 'lucide-react'
import { useDialogFocus } from './useDialogFocus'
import { assetUrl } from './assetUrl'
import { appVersion, appVersionDisplay } from './appVersion'
import { CONTACT_EMAIL, CONTACT_SUJETS, contactCorps, contactMailto, decrireAppareil, joindreTechnique, type ContactSujet, type ContactTechnique } from './contactMail'
import { isNativeRuntime } from './nativeRuntime'
import type { GuestIdentity } from './playerIdentity'

type LegalTab = 'contact' | 'privacy' | 'terms' | 'credits'

export function LegalPanel({ close, identity }: { close: () => void; identity?: GuestIdentity }) {
  // « Nous écrire » d'abord : c'est ce qu'on vient chercher le plus souvent ici.
  const [tab, setTab] = useState<LegalTab>('contact')
  const dialogRef = useDialogFocus<HTMLElement>(close)
  return <div className="mm-modal-layer mm-legal-layer" role="presentation" onMouseDown={event => event.target === event.currentTarget && close()}>
    <section ref={dialogRef} className="mm-legal-panel" role="dialog" aria-modal="true" aria-label="Informations" tabIndex={-1}>
      <header><div><small>MotMan</small><h2>Informations</h2></div><button type="button" onClick={close} aria-label="Fermer"><X /></button></header>
      <div className="mm-legal-tabs" role="tablist" aria-label="Rubriques">
        <button type="button" role="tab" aria-selected={tab === 'contact'} className={tab === 'contact' ? 'active' : ''} onClick={() => setTab('contact')}><MessageSquareText />Contact</button>
        <button type="button" role="tab" aria-selected={tab === 'privacy'} className={tab === 'privacy' ? 'active' : ''} onClick={() => setTab('privacy')}><ShieldCheck />Confidentialité</button>
        <button type="button" role="tab" aria-selected={tab === 'terms'} className={tab === 'terms' ? 'active' : ''} onClick={() => setTab('terms')}><Scale />Conditions</button>
        <button type="button" role="tab" aria-selected={tab === 'credits'} className={tab === 'credits' ? 'active' : ''} onClick={() => setTab('credits')}><BookOpen />Crédits</button>
      </div>
      <div className="mm-legal-scroll">
        {tab === 'contact' ? <ContactForm identity={identity} /> : null}
        {tab === 'privacy' ? <article>
          <h3>Politique de confidentialité</h3><p className="mm-legal-version">Version du 20 septembre 2026</p>
          <h4>Données utilisées</h4><p>MotMan traite les informations nécessaires au compte et au jeu : adresse e-mail lorsque vous protégez un compte, pseudo, apparence du profil, progression, collection, parties, scores, amis, éventuels signalements et jeton technique de notification si vous les autorisez. En cas de plantage, un rapport technique est aussi transmis : modèle de l’appareil, version du système, identifiant technique et trace de l’erreur. Il ne contient ni le contenu de vos parties, ni vos messages.</p>
          <h4>Pourquoi</h4><p>Ces données servent à authentifier les joueurs, synchroniser leur progression, organiser les parties, prévenir les abus, répondre aux signalements, diagnostiquer les pannes et améliorer la qualité des grilles.</p>
          <h4>Stockage et partage</h4><p>Les données en ligne sont hébergées par Supabase, dans un centre de données situé en France. Cloudflare Turnstile protège la création des comptes invités contre les robots et les abus. Firebase Cloud Messaging, service de Google, achemine les notifications de tours et d’invitations vers les appareils qui les autorisent. Firebase Crashlytics, également de Google, reçoit les rapports de plantage. La connexion facultative par compte Google s’appuie sur Google Sign-In. L’appareil conserve aussi un cache local pour les préférences et la continuité de jeu. MotMan ne vend pas les données, n’affiche aucune publicité et ne transmet pas les profils à des annonceurs.</p>
          <h4>Durée et droits</h4><p>Les informations sont conservées pendant la durée nécessaire au fonctionnement du compte, à la sécurité et aux obligations applicables. Les comptes invités non liés et inactifs depuis 30 jours sont supprimés automatiquement. Vous pouvez supprimer immédiatement votre compte depuis le Menu (roue crantée, en haut à droite) → « Compte connecté » (ou « Créer ou retrouver un compte » pour un profil invité) → « Supprimer mon compte », ou demander sa suppression hors de l’application.</p>
          <a className="mm-legal-document" href={assetUrl('/legal/suppression-compte.html')} target="_blank" rel="noreferrer"><FileText />Supprimer un compte MotMan</a>
          <h4>Nous écrire</h4><p>« Nous écrire » ouvre votre application de messagerie avec un message prérempli : rien n’est envoyé ni stocké par MotMan. Le message qui part contient ce que vous écrivez, votre pseudo, votre code ami, la version de l’application et le modèle de votre appareil, pour aider au diagnostic. Ces e-mails sont conservés le temps de traiter la demande.</p>
          <h4>Responsable</h4><p>Le responsable du traitement est Jean-Marie PEETERS, éditeur indépendant de MotMan. Contact : <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</p>
          <h4>Jeunes joueurs</h4><p>MotMan s’adresse aux joueurs de 16 ans et plus et n’est pas destiné aux enfants. Aucun contenu ni service n’y est proposé à destination des mineurs de moins de 16 ans.</p>
        </article> : null}
        {tab === 'terms' ? <article>
          <h3>Conditions d’utilisation</h3><p className="mm-legal-version">Version du 20 septembre 2026</p>
          <h4>Le service</h4><p>MotMan est un jeu de mots fléchés en duel, en ligne. Ses règles, ses grilles et ses récompenses peuvent évoluer pour préserver l’équilibre du jeu.</p>
          <h4>Public et compte</h4><p>MotMan s’adresse aux joueurs de 16 ans et plus et n’est pas destiné aux enfants. Chaque joueur doit protéger son compte et choisir un pseudo approprié.</p>
          <h4>Comportement</h4><p>Le harcèlement, les contenus haineux, sexuels ou discriminatoires, la triche et l’exploitation volontaire de bugs peuvent entraîner une restriction ou une suppression du compte.</p>
          <h4>Objets virtuels</h4><p>Les plumes, avatars, cadres, animations et titres sont des éléments virtuels du jeu. Ils n’ont aucune valeur monétaire, ne sont pas échangeables contre de l’argent et peuvent être rééquilibrés pour préserver l’expérience de jeu.</p>
          <h4>Propriété intellectuelle</h4><p>La direction artistique, le code, les textes originaux et l’organisation du jeu appartiennent à leurs titulaires respectifs. Les ressources tierces restent soumises aux licences indiquées dans les crédits.</p>
          <h4>Disponibilité et contact</h4><p>MotMan cherche à fournir un service fiable, sans pouvoir garantir une disponibilité permanente. Éditeur : Jean-Marie PEETERS, indépendant. Contact : <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</p>
        </article> : null}
        {tab === 'credits' ? <article>
          <h3>Crédits et licences</h3>
          <h4>Création</h4><p>Concept, direction artistique, sélection éditoriale et développement : Jean-Marie PEETERS, projet indépendant MotMan.</p>
          <h4>Typographies</h4><p>DM Sans et Playfair Display sont auto-hébergées et distribuées sous licence SIL Open Font License 1.1. Les textes complets des licences sont inclus avec l’application.</p>
          <h4>Illustrations d’indices</h4><p>Les pictogrammes proviennent de Twemoji (CC BY 4.0), Game Icons (CC BY 3.0) et Streamline (CC BY 4.0). Les crédits détaillés restent associés aux indices concernés dans le catalogue éditorial.</p>
          <h4>Ressources lexicales</h4><p>Le travail éditorial s’appuie notamment sur Lexique, des ressources lexicales ouvertes et des références de mots fléchés citées dans le corpus de recherche. Les définitions publiées sont relues ou réécrites pour MotMan.</p>
          <h4>Logiciels libres</h4><p>MotMan utilise notamment React, Vite, Lucide, Supabase, Capacitor et Capgo Capacitor Updater (licence MPL 2.0, source sur github.com/Cap-go/capacitor-updater) selon leurs licences respectives. Les fichiers de licence des polices et les attributions des images sont conservés dans le paquet de l’application.</p>
          <a className="mm-legal-document" href={assetUrl('/legal/credits.html')} target="_blank" rel="noreferrer"><FileText />Ouvrir la version détaillée</a>
        </article> : null}
      </div>
    </section>
  </div>
}

/**
 * « Nous écrire » : le formulaire prépare l'e-mail, la messagerie du joueur
 * l'envoie (voir src/contactMail.ts). Un lien `mailto:` plutôt qu'un appel
 * JavaScript : dans l'appli installée, c'est la navigation vers ce lien que
 * Capacitor confie à la messagerie du téléphone.
 */
function ContactForm({ identity }: { identity?: GuestIdentity }) {
  const [sujet, setSujet] = useState<ContactSujet>('bug')
  const [message, setMessage] = useState('')
  const choisi = CONTACT_SUJETS.find(entree => entree.id === sujet) ?? CONTACT_SUJETS[0]
  const [copie, setCopie] = useState(false)
  const pret = message.trim().length >= 3
  const technique: ContactTechnique = {
    version: `${appVersionDisplay.updateLabel} · code ${appVersion.buildSha}`,
    support: isNativeRuntime() ? 'appli' : 'site',
    appareil: decrireAppareil(navigator.userAgent),
    ecran: `${window.innerWidth}×${window.innerHeight}`,
    joueur: identity ? { nom: identity.displayName, code: identity.friendCode } : null,
  }
  return <article className="mm-contact">
    <h3>Nous écrire</h3>
    <p>Un bug, une idée, une question ou une demande professionnelle ? Ta messagerie s’ouvre avec le message prêt : il ne reste qu’à l’envoyer.</p>
    <div className="mm-contact-sujets" role="radiogroup" aria-label="Sujet du message">
      {CONTACT_SUJETS.map(entree => <label key={entree.id} className={entree.id === sujet ? 'active' : ''}>
        <input type="radio" name="mm-contact-sujet" value={entree.id} checked={entree.id === sujet} onChange={() => setSujet(entree.id)} />
        {entree.libelle}
      </label>)}
    </div>
    <label className="mm-contact-message">
      <span>Ton message</span>
      <textarea rows={6} maxLength={3000} placeholder={choisi.invite} value={message} onChange={event => setMessage(event.target.value)} />
    </label>
    {joindreTechnique(sujet) ? <p className="mm-contact-note"><Info aria-hidden="true" />La version du jeu et le modèle de ton appareil sont ajoutés au message, pour retrouver le bug plus vite.</p> : null}
    {/* Un `mailto:` ne porte aucun fichier : c'est la messagerie qui s'en charge. */}
    <p className="mm-contact-note"><Paperclip aria-hidden="true" />Une capture d’écran ou un PDF ? Joins-le à l’e-mail qui s’ouvre.</p>
    {pret
      ? <a className="mm-contact-envoyer" href={contactMailto(sujet, message, technique)}><Send aria-hidden="true" />Préparer l’e-mail</a>
      : <button className="mm-contact-envoyer" type="button" disabled><Send aria-hidden="true" />Préparer l’e-mail</button>}
    {!pret ? <p className="mm-contact-direct">Écris quelques mots pour activer le bouton.</p> : null}
    {/* REPLI SANS MESSAGERIE (20/09/2026). Un appareil sans application de
        courrier configurée — le cas des tablettes de résidence — ne fait
        strictement rien au toucher du bouton, et Capacitor avale l'erreur sans
        un mot. Copier le message laisse au joueur de quoi nous écrire autrement. */}
    {pret ? <button type="button" className="mm-contact-copier" onClick={() => {
      const texte = `${CONTACT_EMAIL}

${contactCorps(sujet, message, technique)}`
      void navigator.clipboard?.writeText(texte).then(() => setCopie(true)).catch(() => setCopie(false))
    }}><Copy aria-hidden="true" />{copie ? 'Message copié' : 'Copier le message'}</button> : null}
    <p className="mm-contact-direct">Pas d’application de messagerie ? Écris à <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> depuis n’importe où.</p>
  </article>
}
