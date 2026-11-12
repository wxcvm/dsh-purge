import path from "node:path";
import { readUpdateRecovery, restoreInterruptedUpdate } from "../lib/update-payload.js";

const [dir, flag, ...rest] = process.argv.slice(2);
if (!dir || rest.length || (flag && flag !== "--restore")) {
  console.error('Usage: node scripts/recover-update.mjs <copy-directory> [--restore]');
  process.exitCode = 2;
} else {
  try {
    const root = path.resolve(dir);
    const journal = flag === "--restore" ? await restoreInterruptedUpdate(root) : await readUpdateRecovery(root);
    console.log(JSON.stringify({ phase: journal.phase, touched: journal.touched,
      destinations: [...new Set(journal.entries.map(entry => entry.dest))], backup: root }, null, 2));
    if (!flag) console.log("Read-only inspection. Fully quit all affected hosts before using --restore.");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
