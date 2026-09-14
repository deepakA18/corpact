import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDb, labelSynthetic } from '@corpact/db';
import { createDemoApi } from './api';
import { createDemoChain } from './chain';
import { check, createChecker, type Check } from './checks';
import { writeIssuerFixtures } from './fixtures';
import { startLocalnet, type ValidatorKind } from './localnet';
import { recordedCasesMarkdown } from './present';
import { startProviderProxy } from './proxy';
import { honxSpinOff, loadRecorded, strcxImplausibleCash } from './recorded';
import { DEFAULT_ADMIN_DATABASE_URL, DEMO_DATABASE, REPO_ROOT, recreateDemoDatabase, runWorker } from './runner';
import { runScenario } from './scenario';
import { runWalkthrough } from './walkthrough';

/**
 * One command, three parts:
 *   1. Walkthrough of PLAN §8 on a local network (synthetic): position → no-transfer dividend → entry → split → correction.
 *   2. The recorded HONx and STRCx cases beside the naive reading (recorded issuer data, offline).
 *   3. The synthetic trap regression suite, including the independent-provider disagreement.
 * The worker and API run unmodified. Output: console, walkthrough.md and report.json in apps/demo/out/<run>/.
 */
async function main() {
  const validator = (process.env.DEMO_VALIDATOR ?? 'surfpool') as ValidatorKind;
  if (validator !== 'surfpool' && validator !== 'solana-test-validator') throw new Error('DEMO_VALIDATOR must be surfpool or solana-test-validator');
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = join(REPO_ROOT, 'apps/demo/out', runId);
  const fixturesDir = join(runDir, 'issuer-fixtures');
  mkdirSync(runDir, { recursive: true });
  const started = Date.now();
  const elapsed = () => `${Math.round((Date.now() - started) / 1000)}s`;
  const log = (line: string) => console.log(line);
  const doc: string[] = [];
  const say = (markdown: string) => {
    console.log(`\n${markdown}`);
    doc.push(markdown);
  };
  const description = `SYNTHETIC demo run ${runId}: generated keys, mints and issuer records on a local ${validator} network (offline). Not mainnet history, not issuer data.`;

  say(
    [
      `# Corpact demo — run ${runId}`,
      '',
      `> **Part 1 and Part 3 are SYNTHETIC.** They use a local ${validator} network with no mainnet connection, keys generated for this run, and issuer records written by the demo. The database is permanently labelled synthetic, and every API response and export says so.`,
      '>',
      `> **Part 2 is RECORDED issuer data**, replayed offline. There were no live calls to the issuer.`,
    ].join('\n'),
  );

  const localnet = await startLocalnet(validator, runDir);
  const provider = await startProviderProxy(localnet.workerRpcUrl);
  const checks: Array<Check & { phase: string }> = [];
  const add = (phase: string, list: readonly Check[]) => checks.push(...list.map((c) => ({ ...c, phase })));
  try {
    const chain = await createDemoChain(localnet.rpcUrl, localnet.wsUrl);
    const databaseUrl = await recreateDemoDatabase(process.env.DEMO_ADMIN_DATABASE_URL ?? DEFAULT_ADMIN_DATABASE_URL);
    const env = { databaseUrl, rpcUrl: localnet.workerRpcUrl, fixturesDir, reconciliationRpcUrl: provider.url };
    await runWorker(['migrate'], env);
    const labeller = createDb(databaseUrl);
    await labelSynthetic(labeller, description).finally(() => labeller.end());

    const api = await createDemoApi(databaseUrl);
    try {
      log(`\n[${elapsed()}] Part 1: walkthrough on ${validator}`);
      const walkthrough = await runWalkthrough({ chain, env, runId, fixturesDir, api, say });
      add('walkthrough', walkthrough.checks);

      log(`\n[${elapsed()}] Part 2: recorded cases`);
      const recorded = await loadRecorded();
      say(recordedCasesMarkdown(recorded));
      const honx = honxSpinOff(recorded);
      const strcx = strcxImplausibleCash(recorded);
      add('recorded issuer data', [
        check('HONx spin-off books no income; the naive reading books +95%', honx.corpact.outcome.startsWith('Unclassified') && honx.naive.reading.includes('95.11%'), honx.corpact.reason, 'Multiplier-history reason and size are not evidence'),
        check('STRCx keeps the dividend but refuses the $953k/share valuation', strcx.corpact.outcome === 'Dividend recognized — USD unknown' && strcx.impliedPriceUsd.startsWith('953'), strcx.corpact.reason, 'Issuer cash that does not match shares delivered'),
      ]);

      log(`\n[${elapsed()}] Part 3: seeding the trap regression suite`);
      const scenario = await runScenario(chain, log);
      await chain.waitForClock(scenario.lastActivityUnix + 1n, 'finalized');
      const fixtures = (actions: typeof scenario.actions) => ({
        assets: [walkthrough.asset, ...scenario.assets],
        history: [...walkthrough.history, ...scenario.history],
        actions: [...walkthrough.actions, ...actions],
      });

      writeIssuerFixtures(fixturesDir, runId, fixtures(scenario.actions));
      await runWorker(['sync-registry'], env);
      await runWorker(['import-issuer-actions'], env);
      await runWorker(['sync-wallet', scenario.holder], env);
      const checker = await createChecker(api, scenario);
      add('suite: first sync', await checker.firstSync());

      log(`[${elapsed()}] The issuer publishes a late record and a correction; re-sync`);
      writeIssuerFixtures(fixturesDir, runId, fixtures([...scenario.actions, ...scenario.laterActions]));
      await runWorker(['import-issuer-actions'], env);
      await runWorker(['sync-wallet', scenario.holder], env);
      add('suite: late record + correction', await checker.afterCorrections());

      log(`[${elapsed()}] Replaying with no new evidence`);
      const before = await checker.snapshot();
      await runWorker(['sync-wallet', scenario.holder], env);
      add('suite: deterministic replay', checker.determinism(before, await checker.snapshot()));

      log(`[${elapsed()}] The independent provider misreports one DDIVx balance; re-sync`);
      const ddivMint = scenario.assets.find((a) => a.symbol === 'DDIVx')!.mint;
      const misreported = await chain.tokenAccount(scenario.holder, ddivMint as typeof scenario.holder);
      const beforeDisagreement = await checker.snapshot();
      provider.misreport(misreported);
      await runWorker(['sync-wallet', scenario.holder], env);
      add('suite: independent provider disagrees', await checker.providerDisagreement(misreported, beforeDisagreement));

      log(`[${elapsed()}] The provider is honest again; re-sync`);
      provider.misreport(null);
      await runWorker(['sync-wallet', scenario.holder], env);
      add('suite: providers agree again', await checker.providersAgreeAgain());

      const failed = checks.filter((c) => !c.pass);
      say(
        [
          `## Part 3 — Trap regression suite (SYNTHETIC), and every check in this run`,
          '',
          'Part 3 runs every Phase 0 trap the ledger can reproduce without a price source through the full chain → worker → API path, then checks what happens when an independent RPC provider disagrees.',
          '',
          `**${checks.length - failed.length} of ${checks.length} checks passed** across all three parts, all read back through the API.`,
          '',
          ...[...new Set(checks.map((c) => c.phase))].flatMap((phase) => [
            `**${phase}**`,
            '',
            ...checks.filter((c) => c.phase === phase).map((c) => `- ${c.pass ? '✅' : '❌'} ${c.name}${c.pass ? '' : ` — ${c.detail}`}`),
            '',
          ]),
        ].join('\n'),
      );

      writeFileSync(join(runDir, 'walkthrough.md'), `${doc.join('\n\n')}\n`);
      writeFileSync(
        join(runDir, 'report.json'),
        `${JSON.stringify(
          { dataset: 'synthetic', description, runId, validator, walkthroughHolder: walkthrough.asset, suiteHolder: scenario.holder, events: scenario.events, checks },
          (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v),
          2,
        )}\n`,
      );
      log(`\n${checks.length - failed.length}/${checks.length} checks passed in ${elapsed()}`);
      for (const c of failed) log(`FAIL  [${c.phase}] ${c.name}: ${c.detail}`);
      log(`Walkthrough document: ${join(runDir, 'walkthrough.md')}`);
      log(`The ${DEMO_DATABASE} database (labelled synthetic) is kept until the next run.`);
      if (failed.length > 0) process.exitCode = 1;
    } finally {
      await api.close();
    }
  } finally {
    await provider.close();
    await localnet.stop();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : error);
  process.exitCode = 1;
});
