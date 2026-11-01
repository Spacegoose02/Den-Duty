import { config } from './config.ts';
import { openDb } from './db.ts';
import { buildApp } from './app.ts';
import { checkDueReminders } from './routes/reminders.ts';
import { checkPush } from './push.ts';
import { runMoney } from './money.ts';
import { homeToday } from './chores.ts';
import type { Row } from './db.ts';

const db = openDb(config.dataDir);
const app = await buildApp(db, { logger: true });

await app.listen({ port: config.port, host: config.host });
app.log.info(`Den Duty is up and sweeping at ${config.publicUrl}`);
if (!config.google) app.log.info('Google sign-in is off (set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to turn it on)');

// Reminders that come due tell Home Assistant (reminder_due), checked every minute.
// Also: due-soon nudges and the weekly recap push, and allowance / interest paydays.
const reminderTimer = setInterval(() => {
  try { checkDueReminders(db); } catch (err) { app.log.error(err); }
  try { checkPush(db); } catch (err) { app.log.error(err); }
  try {
    for (const h of db.prepare('SELECT id, timezone FROM homes WHERE money_enabled = 1').all() as Row[]) runMoney(db, h.id as string, homeToday({ timezone: h.timezone as string }));
  } catch (err) { app.log.error(err); }
}, 60e3);
reminderTimer.unref();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await app.close();
    db.close();
    process.exit(0);
  });
}
