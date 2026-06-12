/**
 * scripts/test-bid-cycle.ts
 *
 * End-to-end verification of the full pipeline on the REAL authenticated
 * session, WITHOUT posting a bid by default.
 *
 *   Parse feed → pick 1 project → generate proposal → open project page →
 *   locate + fill bid form → (dry-run: stop) → report status.
 *
 * Run:
 *   # safe: fills the form but never clicks submit
 *   npx tsx scripts/test-bid-cycle.ts
 *
 *   # real: actually posts ONE bid to the first feed project
 *   CONFIRM_REAL_BID=1 npx tsx scripts/test-bid-cycle.ts
 *
 * Requires the same env the worker uses (FH_STORAGE_STATE pointing at the saved
 * Freelancehunt session, OPENAI_API_KEY optional).
 */

import 'dotenv/config';
import { parseProjectsFromFeed } from '../services/playwright-browser.service';
import { generateAutoBid } from '../services/ai-bid.service';
import { submitBidViaBrowser } from '../services/playwright-bid.service';

const log = (level: string, message: string) =>
  console.log(`[${level.toUpperCase()}] ${message}`);

async function main() {
  const dryRun = process.env.CONFIRM_REAL_BID !== '1';
  log('info', `Mode: ${dryRun ? 'DRY RUN (no bid posted)' : 'REAL BID (will post one bid)'}`);

  // 1. Parse
  log('info', 'Step 1/5 — parsing feed…');
  const projects = await parseProjectsFromFeed((lvl, msg) => log(lvl, msg));
  if (projects.length === 0) {
    log('error', 'No projects parsed — check session / selectors. Aborting.');
    process.exit(1);
  }
  const project = projects[0];
  log('success', `Picked project: "${project.title}" (${project.id}) ${project.budget} ${project.currency}`);
  log('info', `URL: ${project.projectUrl}`);

  // 2. Proposal
  log('info', 'Step 2/5 — generating proposal…');
  const bid = await generateAutoBid({
    id: project.id,
    freelancehuntId: project.id.replace('fh_', ''),
    title: project.title,
    description: project.description,
    budget: project.budget,
    currency: project.currency as never,
    skills: project.skills,
    projectUrl: project.projectUrl,
    publishedAt: project.publishedAt,
    category: '',
    clientName: '',
    bidsCount: 0,
    isNew: true,
  } as never);
  log('success', `Proposal ready — price:${bid.price} deadline:${bid.deadline} fallback:${Boolean(bid.usedFallback)}`);

  // 3-5. Open → fill → (submit or stop)
  log('info', `Step 3-5/5 — opening project page, filling${dryRun ? '' : ' + submitting'}…`);
  const days = parseInt(String(bid.deadline ?? '14'), 10) || 14;
  const result = await submitBidViaBrowser({
    projectId: project.id.replace('fh_', ''),
    projectUrl: project.projectUrl,
    comment: bid.text,
    amount: bid.price && bid.price > 0 ? bid.price : project.budget || 500,
    days,
    safeType: 'no_safe',
    dryRun,
    log: (lvl, msg) => log(lvl, msg),
  });

  log(result.success || result.status === 'dry_run' ? 'success' : 'error',
    `RESULT — status:${result.status} success:${result.success} reason:${result.reason}` +
    (result.bidId ? ` bidId:${result.bidId}` : ''));

  process.exit(result.status === 'failed' || result.status === 'login_required' ? 1 : 0);
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});