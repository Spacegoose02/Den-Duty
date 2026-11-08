import { config } from './config.ts';
import { openDb } from './db.ts';
import { applyPendingRestore, nightlyBackup } from './backup.ts';
import { endFinishedSessions } from './screentime.ts';
import { syncAllDue } from './calsync.ts';
import { buildApp } from './app.ts';
import { checkDueReminders } from './routes/reminders.ts';
import { topUpSeries } from './routes/therapy.ts';
import { checkPush } from './push.ts';
import { runMoney } from './money.ts';
import { homeInfo, homeToday } from './chores.ts';
import type { Row } from './db.ts';

// A restore an admin staged swaps in before the database opens (the old one is kept as a backup).
const restored = applyPendingRestore(config.dataDir);
const db = openDb(config.dataDir);
const app = await buildApp(db, { logger: true });

await app.listen({ port: config.port, host: config.host });
app.log.info(`Den Duty is up and sweeping at ${config.publicUrl}`);
if (restored) app.log.info('Restored the database from a backup (the one it replaced is in the backups folder)');
if (!config.google) app.log.info('Google sign-in is off (set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to turn it on)');

// Reminders that come due tell Home Assistant (reminder_due), checked every minute.
// Also: due-soon nudges and the weekly recap push, allowance / interest paydays, and the next visits of repeating appointments.
const reminderTimer = setInterval(() => {
  try { checkDueReminders(db); } catch (err) { app.log.error(err); }
  try { checkPush(db); } catch (err) { app.log.error(err); }
  try { topUpSeries(db); } catch (err) { app.log.error(err); }
  try { if (nightlyBackup(db, config.dataDir)) app.log.info('Nightly backup saved'); } catch (err) { app.log.error(err); }
  // Linked calendars (Google, Outlook, iCloud...): both ways, every 15 minutes.
  void syncAllDue(db).catch((err) => app.log.error(err));
  try {
    for (const h of db.prepare('SELECT id, timezone FROM homes WHERE money_enabled = 1').all() as Row[]) runMoney(db, h.id as string, homeToday({ timezone: h.timezone as string }));
  } catch (err) { app.log.error(err); }
}, 60e3);
reminderTimer.unref();

// Screen-time sessions end on time (checked every 15 seconds, so the TV goes off when it should).
const screenTimer = setInterval(() => {
  try { endFinishedSessions(db, (homeId) => homeToday(homeInfo(db, homeId))); } catch (err) { app.log.error(err); }
}, 15e3);
screenTimer.unref();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await app.close();
    db.close();
    process.exit(0);
  });
}
