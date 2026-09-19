// Génère l'image d'aperçu de MotMan (1200×630) : celle que Google, WhatsApp,
// Messenger, Facebook… affichent sous un lien doctox.fr/motman, dont les
// partages « Défi lancé ». Déclarée par og:image dans index.html et dans la page
// de présentation (public/mots-fleches-en-duel/).
//   node scripts/build_social_image.mjs
//
// La mini-grille est une illustration : ses mots (DUEL, MOTS, AMIE, JEUX) ne
// viennent d'aucune grille du catalogue, pour ne rien dévoiler d'une partie.
import { mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'

const SORTIE = path.resolve('public/assets/social/motman-partage.jpg')
const police = fichier => readFileSync(path.resolve('public/assets/fonts', fichier)).toString('base64')
const logo = readFileSync(path.resolve('public/assets/motman-logo-v2.png')).toString('base64')

// Une ligne : la définition, puis 4 cases — lettre et joueur (v = vous, a = adversaire), ou vide.
const LIGNES = [
  ['Combat', [['D', 'v'], ['U', 'v'], ['E', 'a'], ['L', 'a']]],
  ['Termes', [['M', 'a'], null, ['T', 'v'], null]],
  ['Copine', [['A', 'v'], ['M', 'v'], null, ['E', 'a']]],
  ['Parties', [null, ['E', 'a'], null, null]],
]

const grille = LIGNES.map(([definition, cases]) => `<span class="clue">${definition}<b>→</b></span>${cases
  .map(c => c ? `<span class="${c[1] === 'v' ? 'vous' : 'adv'}">${c[0]}</span>` : '<span></span>').join('')}`).join('')

const html = `<!doctype html><html><head><style>
@font-face{font-family:'DM Sans';src:url(data:font/woff2;base64,${police('dm-sans-latin-variable.woff2')}) format('woff2');font-weight:100 1000}
@font-face{font-family:'Playfair Display';src:url(data:font/woff2;base64,${police('playfair-display-latin-variable.woff2')}) format('woff2');font-weight:400 900}
*{box-sizing:border-box}
body{margin:0}
.carte{position:relative;width:1200px;height:630px;overflow:hidden;display:grid;grid-template-columns:600px 1fr;align-items:center;padding:0 64px;
  background:radial-gradient(circle at 78% 40%,#fffdf8 0,#fffaf0 38%,#f3ecdc 100%);font-family:'DM Sans',sans-serif;color:#073f36}
.carte::after{content:'';position:absolute;inset:0 0 auto;height:14px;background:#073f36}
.logo{display:block;width:380px;margin:0 0 30px}
h1{margin:0;font:800 70px/1.02 'Playfair Display',serif;letter-spacing:-.01em}
p{margin:22px 0 0;font-size:30px;line-height:1.3;color:#24594f;max-width:520px}
.puces{display:flex;flex-wrap:wrap;gap:10px;margin-top:30px}
.puces span{padding:9px 16px;border:2px solid #d7d1c2;border-radius:999px;background:#fffdf8;font-size:21px;font-weight:700;color:#176b58}
.adresse{position:absolute;left:64px;bottom:34px;font-size:24px;font-weight:800;color:#c94d29;letter-spacing:.01em}
.jeu{justify-self:end;display:grid;gap:16px;transform:rotate(-2.5deg)}
.scores{display:flex;justify-content:space-between;font-size:22px;font-weight:800}
.scores span{padding:8px 16px;border-radius:999px}
.scores .vous{background:#073f36;color:#fffaf0}
.scores .adv{background:#c94d29;color:#fffaf0}
.grille{display:grid;grid-template-columns:repeat(5,94px);grid-auto-rows:94px;border:3px solid #073f36;border-radius:18px;overflow:hidden;background:#fffdf8;
  box-shadow:0 26px 60px #173b3033}
.grille span{display:grid;place-items:center;border-right:1.5px solid #b8b6aa;border-bottom:1.5px solid #b8b6aa;font:700 50px/1 'Playfair Display',serif}
.grille span:nth-child(5n){border-right:0}
.grille span:nth-last-child(-n+5){border-bottom:0}
.grille .clue{position:relative;padding:6px 18px 6px 6px;background:#e8ece2;font:700 15px/1.1 'DM Sans',sans-serif;text-align:center;color:#24594f}
.grille .clue b{position:absolute;right:4px;top:50%;translate:0 -50%;font-size:18px;color:#073f36}
.grille .vous{background:#eaf5ee;color:#073f36}
.grille .adv{background:#fff0e9;color:#c94d29}
</style></head><body><div class="carte">
  <div>
    <img class="logo" alt="" src="data:image/png;base64,${logo}">
    <h1>Mots fléchés<br>en duel</h1>
    <p>Une grille, deux joueurs. Et chaque jour, un défi à thème.</p>
    <div class="puces"><span>Gratuit</span><span>Défi du jour</span><span>Entre amis</span></div>
  </div>
  <div class="jeu">
    <div class="scores"><span class="vous">Toi · 12</span><span class="adv">Adversaire · 9</span></div>
    <div class="grille">${grille}</div>
  </div>
  <div class="adresse">doctox.fr/motman</div>
</div></body></html>`

mkdirSync(path.dirname(SORTIE), { recursive: true })
const navigateur = await chromium.launch()
try {
  const page = await navigateur.newPage({ viewport: { width: 1200, height: 630 } })
  await page.setContent(html)
  await page.evaluate(() => document.fonts.ready)
  await page.locator('.carte').screenshot({ path: SORTIE, type: 'jpeg', quality: 88 })
  console.log(`${path.relative(process.cwd(), SORTIE)} (1200×630)`)
} finally {
  await navigateur.close()
}
