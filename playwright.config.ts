import { defineConfig, devices } from '@playwright/test'
import { resolve } from 'node:path'

const stateDirectory = resolve('output/playwright/state')

// Le port du serveur de test. Fixe par défaut, mais déplaçable : deux sessions
// qui travaillent en parallèle sur 4175 se prêtent leur serveur (`reuseExisting`)
// et finissent par tester le code de l'autre.
const port = process.env.MOTMAN_E2E_PORT ?? '4175'

// Les durées que le serveur de test reçoit ET que les bancs d'essai relisent.
// Elles étaient écrites une seule fois, dans l'objet `env` ci-dessous : un test
// qui voulait les connaître recopiait le nombre, ou lisait un `process.env` que
// le processus Playwright n'a pas — il ne le transmet qu'au serveur.
export const E2E_TURN_DURATION_MS = 12_000
export const E2E_FIRST_TURN_READING_MS = 5_000
// « Tu es toujours là ? » : 30 s en production, 8 s ici — assez pour ouvrir la
// page et répondre, assez court pour attendre la défaite sans ralentir la suite.
export const E2E_PRESENCE_WINDOW_MS = 8_000

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 75_000,
  expect: { timeout: 12_000 },
  reporter: 'line',
  outputDir: 'output/playwright/results',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['iPhone 13'] } },
  ],
  webServer: {
    command: `npm run dev -- --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      ...process.env,
      MOTMAN_MATCH_DATABASE_PATH: resolve(stateDirectory, 'matches.json'),
      MOTMAN_SOCIAL_DATABASE_PATH: resolve(stateDirectory, 'social.json'),
      // Keep enough room for two cold mobile contexts while making the
      // 2 s / 1 s / 0 s boundary matrix practical on every test run.
      // Production remains at 45 seconds.
      MOTMAN_TURN_DURATION_MS: String(E2E_TURN_DURATION_MS),
      // Vingt secondes, plus six : depuis le 18/09/2026, un tour illimité laissé
      // passer est un abandon (src/gameRules.ts). À six secondes, un test qui
      // gardait une partie ouverte un peu longtemps la perdait au hasard.
      MOTMAN_ASYNC_TURN_DURATION_MS: '20000',
      // Long enough for Chromium/WebKit to observe the two-beat turn cue reliably.
      MOTMAN_TURN_READY_DURATION_MS: '350',
      // La fenêtre de lecture du premier tour vaut dix secondes en production.
      // Raccourcie ici comme le reste, mais pas trop : la page doit avoir le temps
      // de se charger AVANT la fin de la fenêtre, sinon le bandeau n'est jamais vu.
      MOTMAN_FIRST_TURN_READING_MS: String(E2E_FIRST_TURN_READING_MS),
      MOTMAN_PRESENCE_WINDOW_MS: String(E2E_PRESENCE_WINDOW_MS),
      MOTMAN_TURN_GRACE_MS: '1200',
      MOTMAN_AUTOMATIC_TURN_GRACE_MS: '4000',
      MOTMAN_REVEAL_STEP_MS: '30',
      MOTMAN_MIN_REVEAL_DURATION_MS: '20',
      MOTMAN_REALTIME_BOT_DELAY_MS: '60000',
      MOTMAN_ASYNC_BOT_DELAY_MS: '60000',
      VITE_MOTMAN_LOCAL_TEST_SERVER: 'true',
      // Les vingt-cinq secondes d'inactivité qui mettent l'indice et le mélange
      // en valeur (src/game/idleAssist.ts). Trois secondes ici : elles doivent
      // tenir dans un tour illimité raccourci à six. Lu par le client, donc
      // préfixé VITE_, et seulement derrière VITE_MOTMAN_LOCAL_TEST_SERVER.
      VITE_MOTMAN_IDLE_ASSIST_MS: '3000',
    },
  },
})
