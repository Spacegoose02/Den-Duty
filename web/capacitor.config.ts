import type { CapacitorConfig } from '@capacitor/cli';

// The Android app ships the small launcher page, which asks for your server's address and then opens it.
// To bake in one server instead, build with SERVER_URL=https://chores.example.com npm run android
const serverUrl = process.env.SERVER_URL;

const config: CapacitorConfig = {
  appId: 'io.github.denduty.app',
  appName: 'Den Duty',
  webDir: '../apps/launcher',
  server: {
    ...(serverUrl ? { url: serverUrl } : {}),
    // Self-hosted servers live at addresses we can't know ahead of time, and many are plain http on the LAN.
    allowNavigation: ['*'],
    cleartext: true,
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: true,
  },
};

export default config;
