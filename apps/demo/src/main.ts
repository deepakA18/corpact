import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDemoChain } from './chain';
import { createChecker, type Check } from './checks';
import { writeIssuerFixtures } from './fixtures';
import { startLocalnet } from './localnet';
import { startRpcProxy } from './proxy';
import { DEFAULT_ADMIN_DATABASE_URL, DEMO_DATABASE, REPO_ROOT, recreateDemoDatabase, runWorker } from './runner';
import { runScenario } from './scenario';

/**
 * PLAN §8 demo on synthetic events, with the Phase 0 trap cases. Everything runs locally:
 * a fresh test validator, throwaway keys, generated issuer fixtures and the `corpact_demo`
 * database. The worker and API run unmodified; checks read results through the public API.
 */
async function main() {
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = join(REPO_ROOT, 'apps/demo/out', runId);
  const fixturesDir = join(runDir, 'issuer-fixtures');
  mkdirSync(runDir, { recursive: true });
  const log = (line: string) => console.log(line);
  const started = Date.now();
  const elapsed = () => `${Math.round((Date.now() - started) / 1000)}s`;

  log(`Corpact synthetic demo ${runId}\n(local validator only; nothing here is mainnet history or issuer data)\n`);
  const localnet = await startLocalnet(join(runDir, 'ledger'), () => {});
  // The "independent provider": honest until the disagreement phase.
  const provider = await startRpcProxy(localnet.rpcUrl);
  const checks: Array<Check & { phase: string }> = [];
  try {
    log(`[${elapsed()}] Seeding the scenario on the local validator`);
    const chain = await createDemoChain(localnet.rpcUrl, localnet.wsUrl);
    const scenario = await runScenario(chain, log);
    log(`[${elapsed()}] Waiting for finalization`);
    await chain.waitForClock(scenario.lastActivityUnix + 1n, 'finalized');

    const databaseUrl = await recreateDemoDatabase(process.env.DEMO_ADMIN_DATABASE_URL ?? DEFAULT_ADMIN_DATABASE_URL);
    const env = { databaseUrl, rpcUrl: localnet.rpcUrl, fixturesDir, reconciliationRpcUrl: provider.url };
    const baseFixtures = { assets: scenario.assets, history: scenario.history };

    log(`[${elapsed()}] First sync: issuer records published so far`);
    writeIssuerFixtures(fixturesDir, runId, { ...baseFixtures, actions: scenario.actions });
    await runWorker(['migrate'], env);
    await runWorker(['sync-registry'], env);
    await runWorker(['import-issuer-actions'], env);
    await runWorker(['sync-wallet', scenario.holder], env);

    const checker = await createChecker(databaseUrl, scenario);
    try {
      checks.push(...(await checker.firstSync()).map((c) => ({ ...c, phase: 'first sync' })));

      log(`[${elapsed()}] Issuer publishes a late record and a correction; re-sync`);
      writeIssuerFixtures(fixturesDir, runId, { ...baseFixtures, actions: [...scenario.actions, ...scenario.laterActions] });
      await runWorker(['import-issuer-actions'], env);
      await runWorker(['sync-wallet', scenario.holder], env);
      checks.push(...(await checker.afterCorrections()).map((c) => ({ ...c, phase: 'late record + correction' })));

      log(`[${elapsed()}] Replaying again with no new evidence`);
      const before = await checker.snapshot();
      await runWorker(['sync-wallet', scenario.holder], env);
      checks.push(...checker.determinism(before, await checker.snapshot()).map((c) => ({ ...c, phase: 'deterministic replay' })));

      log(`[${elapsed()}] The independent provider misreports one DDIVx balance; re-sync`);
      const ddivMint = scenario.assets.find((a) => a.symbol === 'DDIVx')!.mint;
      const misreported = await chain.tokenAccount(scenario.holder, ddivMint as typeof scenario.holder);
      const beforeDisagreement = await checker.snapshot();
      provider.misreport(misreported);
      await runWorker(['sync-wallet', scenario.holder], env);
      checks.push(...(await checker.providerDisagreement(misreported, beforeDisagreement)).map((c) => ({ ...c, phase: 'independent provider disagrees' })));

      log(`[${elapsed()}] The provider is honest again; re-sync`);
      provider.misreport(null);
      await runWorker(['sync-wallet', scenario.holder], env);
      checks.push(...(await checker.providersAgreeAgain()).map((c) => ({ ...c, phase: 'providers agree again' })));
    } finally {
      await checker.close();
    }

    writeFileSync(
      join(runDir, 'report.json'),
      `${JSON.stringify({ runId, holder: scenario.holder, assets: scenario.assets, events: scenario.events, checks }, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v), 2)}\n`,
    );
    printReport(checks, log);
    log(`\nRun artifacts: ${runDir}`);
    log(`Explore it: DATABASE_URL=${databaseUrl.replace(/:[^:@/]*@/, ':***@')} with the API and dashboard; holder ${scenario.holder}`);
    log(`The ${DEMO_DATABASE} database is recreated on every run.`);
    if (checks.some((c) => !c.pass)) process.exitCode = 1;
  } finally {
    await provider.close();
    localnet.stop();
  }
}

function printReport(checks: ReadonlyArray<Check & { phase: string }>, log: (line: string) => void) {
  let phase = '';
  for (const c of checks) {
    if (c.phase !== phase) {
      phase = c.phase;
      log(`\n── ${phase} ──`);
    }
    log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}`);
    if (c.trap) log(`      trap: ${c.trap}`);
    if (!c.pass || c.detail) log(`      ${c.detail}`);
  }
  const failed = checks.filter((c) => !c.pass).length;
  log(`\n${checks.length - failed}/${checks.length} checks passed`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : error);
  process.exitCode = 1;
});
