import type { IncomeEntry, IncomeResponse, JournalResponse, OpsStatusResponse, Portfolio, YieldResponse } from '@corpact/client';
import { Rational } from '@corpact/domain';
import type { DemoApi } from './api';
import type { ExpectedEntry, Scenario, TrapEvent } from './scenario';

export interface Check {
  name: string;
  trap: string | null;
  pass: boolean;
  detail: string;
}

export interface LedgerSnapshot {
  journalRows: number;
  income: string;
  portfolio: string;
}

export const check = (name: string, pass: boolean, detail: string, trap: string | null = null): Check => ({ name, trap, pass, detail });
export const includes = (texts: readonly string[], needle: string) => texts.some((t) => t.toLowerCase().includes(needle.toLowerCase()));

function describeEntry(e: IncomeEntry | undefined): string {
  if (!e) return 'no entry';
  const usd = e.usd === null ? 'USD unknown' : `USD ${e.usd}`;
  const notes = [...e.warnings, ...e.reasons];
  return `${e.kind}${e.kind === 'dividend' ? `, ${usd}` : ''}${e.revision > 1 ? `, revision ${e.revision}` : ''}${notes.length ? ` — ${notes.join('; ')}` : ''}`;
}

function matches(e: IncomeEntry | undefined, expected: ExpectedEntry): boolean {
  if (!e || e.kind !== expected.kind) return false;
  if (expected.kind === 'dividend') {
    return expected.usd === 'valued' ? e.usd !== null : e.usd === null && includes(e.warnings, expected.warning);
  }
  if (expected.kind === 'unclassified_adjustment') return includes(e.reasons, expected.reason);
  return e.usd === null;
}

/** The trap regression suite's checks, read through the demo API for the scenario's holder. */
export async function createChecker(api: DemoApi, scenario: Scenario) {
  await api.register(scenario.holder);
  const owner = encodeURIComponent(scenario.holder);
  const { db } = api;

  const income = async () => (await api.get<IncomeResponse>(`/v1/income?owner=${owner}&limit=200`)).entries;
  const journal = async () => (await api.get<JournalResponse>(`/v1/journal?owner=${owner}&limit=200`)).entries;
  const portfolio = () => api.get<Portfolio>(`/v1/portfolio?owner=${owner}`);
  const position = (p: Portfolio, symbol: string) => p.positions.find((x) => x.symbol === symbol);
  const opsCheck = async (name: string) => (await api.get<OpsStatusResponse>('/v1/ops/status', 'ops')).checks.find((c) => c.name === name);
  const latestBalanceCheck = async () =>
    (
      await db.query(
        `SELECT outcome, details, secondary_host FROM provider_checks WHERE kind = 'token_balances' AND subject = $1 ORDER BY id DESC LIMIT 1`,
        [scenario.holder],
      )
    ).rows[0] as { outcome: string; details: Array<{ account: string; primaryRaw: string | null; secondaryRaw: string | null }>; secondary_host: string } | undefined;

  /** Income entries per symbol, oldest first, lined up against the scenario's expectations. */
  function eventChecks(entries: readonly IncomeEntry[], pick: (e: TrapEvent) => ExpectedEntry | null): Check[] {
    const checks: Check[] = [];
    for (const symbol of new Set(scenario.events.map((e) => e.symbol))) {
      const expected = scenario.events.filter((e) => e.symbol === symbol && pick(e) !== null).toSorted((a, b) => (a.scheduledUnix < b.scheduledUnix ? -1 : 1));
      const actual = entries
        .filter((e) => e.symbol === symbol)
        .toSorted((a, b) => a.effectiveAt.localeCompare(b.effectiveAt) || Number(a.id) - Number(b.id));
      if (actual.length !== expected.length) {
        checks.push(check(`${symbol}: one income entry per active multiplier change`, false, `expected ${expected.length}, API returned ${actual.length}`));
      }
      expected.forEach((event, i) => {
        const entry = actual[i];
        checks.push(check(`${symbol} ${event.label}`, matches(entry, pick(event)!), describeEntry(entry), event.trap));
      });
    }
    return checks;
  }

  async function chainVersion(scheduledUnix: bigint) {
    const { rows } = await db.query(
      `SELECT v.status, v.immediate, v.effective_unix FROM multiplier_versions v JOIN assets a ON a.mint = v.mint
        WHERE a.symbol = 'DDIVx' AND v.scheduled_unix = $1`,
      [scheduledUnix.toString()],
    );
    return rows[0] as { status: string; immediate: boolean; effective_unix: string } | undefined;
  }

  async function snapshot(): Promise<LedgerSnapshot> {
    const entries = await income();
    const p = await portfolio();
    return {
      journalRows: (await journal()).length,
      income: JSON.stringify(
        entries
          .map(({ id: _id, headline: _headline, ...rest }) => rest)
          .toSorted((a, b) => a.effectiveAt.localeCompare(b.effectiveAt) || a.symbol.localeCompare(b.symbol)),
      ),
      portfolio: JSON.stringify(
        p.positions.map((x) => [x.symbol, x.status, x.quantity, x.protectedQuantity, x.availableQuantity, x.dividendIncomeUsd, x.unvaluedDividendEvents, x.reconciled]),
      ),
    };
  }

  let firstSyncJournal: JournalResponse['entries'] = [];
  let firstSyncD1Usd: string | null = null;
  const d1Activation = scenario.events.find((e) => e.label.startsWith('D1'))!.scheduledUnix;

  return {
    snapshot,

    async firstSync(): Promise<Check[]> {
      const entries = await income();
      const p = await portfolio();
      const yields = await api.get<YieldResponse>(`/v1/yield?owner=${owner}`);
      const checks = eventChecks(entries, (e) => e.firstSync);

      const superseded = await chainVersion(scenario.supersededScheduleUnix);
      checks.push(
        check(
          'DDIVx X is recorded as superseded and never booked',
          superseded?.status === 'superseded',
          `multiplier version status: ${superseded?.status ?? 'not recorded'}`,
          'A pending multiplier overwritten before its time never becomes live',
        ),
      );
      const late = await chainVersion(scenario.latePublication.scheduledUnix);
      const ddiv = position(p, 'DDIVx');
      checks.push(
        check(
          'DDIVx D6 applies at publication and leaves no history gap',
          late?.immediate === true && late.effective_unix === scenario.latePublication.publishedUnix.toString() && (ddiv?.coverage.gaps.length ?? 1) === 0,
          `immediate=${late?.immediate}, effective ${late?.effective_unix} (published ${scenario.latePublication.publishedUnix}), coverage gaps: ${ddiv?.coverage.gaps.length ?? 'no position'}`,
          'VTIx 2026-03-26: a late write must not read as missing history',
        ),
      );
      checks.push(
        check(
          'DDIVx replays deposit, withdrawal and split to the exact chain balance',
          ddiv?.status === 'complete' && ddiv.reconciled,
          `status ${ddiv?.status}, reconciled ${ddiv?.reconciled}, quantity ${ddiv?.quantity}, protected ${ddiv?.protectedQuantity}`,
          'Historical transfers and splits replay deterministically; exact raw-unit reconciliation',
        ),
      );

      const valued = entries.filter((e) => e.symbol === 'DDIVx' && e.kind === 'dividend' && e.usd !== null);
      const sum = valued.reduce((total, e) => total.add(Rational.fromDecimal(e.usd!)), Rational.ZERO);
      checks.push(
        check(
          'DDIVx income is exactly the valued dividends: the split, spin-off and unmatched change add nothing',
          ddiv !== undefined && Rational.fromDecimal(ddiv.dividendIncomeUsd).eq(sum),
          `position income ${ddiv?.dividendIncomeUsd} vs ${valued.length} valued dividends summing to ${sum.toTerminatingDecimal()}`,
          '"Any increase is income" is wrong: 24 of the recorded increases were not cash dividends',
        ),
      );
      checks.push(
        check(
          'DDIVx counts dividends without a trustworthy value instead of zeroing them',
          ddiv?.unvaluedDividendEvents === 2,
          `unvalued dividend events: ${ddiv?.unvaluedDividendEvents}`,
          'Missing or implausible issuer cash is unknown, never zero',
        ),
      );

      const dpar = position(p, 'DPARx');
      const dparYield = yields.positions.find((x) => x.symbol === 'DPARx');
      checks.push(
        check(
          'DPARx is partial: it was held before its multiplier history is observable',
          dpar?.status === 'partial' && includes(dpar.coverage.gaps, 'multiplier is known only from'),
          `status ${dpar?.status}; ${dpar?.coverage.gaps.join('; ') || 'no gaps'}`,
          'Partial history is visible',
        ),
      );
      checks.push(
        check(
          'DPARx claims no yield; DDIVx claims yield over its fully covered tracked period',
          (dparYield?.windows.length ?? 0) > 0 &&
            dparYield!.windows.every((w) => w.shareYield === null && w.excluded?.code === 'position_incomplete') &&
            yields.positions.find((x) => x.symbol === 'DDIVx')?.windows.some((w) => w.window === 'tracked' && w.shareYield !== null && w.excluded === null) === true,
          `DPARx windows: ${dparYield?.windows.map((w) => `${w.window}=${w.excluded?.code ?? w.shareYield}`).join(', ')}`,
          'Partial history is excluded from yield claims',
        ),
      );

      const provider = await latestBalanceCheck();
      checks.push(
        check(
          'The independent provider agrees on every balance',
          provider?.outcome === 'agree',
          `latest check: ${provider?.outcome ?? 'none recorded'}${provider ? ` against ${provider.secondary_host}` : ''}`,
          'PLAN Appendix B: a primary provider plus an independent reconciliation RPC',
        ),
      );

      firstSyncJournal = await journal();
      checks.push(
        check(
          'The first sync only recognizes; nothing is reversed',
          firstSyncJournal.length > 0 && firstSyncJournal.every((j) => j.entryType === 'recognition'),
          `${firstSyncJournal.length} journal rows`,
        ),
      );
      // The API lists newest first; D1 is the earliest DDIVx dividend.
      firstSyncD1Usd =
        entries.filter((e) => e.symbol === 'DDIVx' && e.kind === 'dividend').toSorted((a, b) => a.effectiveAt.localeCompare(b.effectiveAt))[0]?.usd ?? null;
      return checks;
    },

    async afterCorrections(): Promise<Check[]> {
      const entries = await income();
      const p = await portfolio();
      const rows = await journal();
      const checks = eventChecks(entries, (e) => (e.afterCorrections === undefined ? e.firstSync : e.afterCorrections));

      const d1 = entries
        .filter((e) => e.symbol === 'DDIVx' && e.kind === 'dividend')
        .toSorted((a, b) => a.effectiveAt.localeCompare(b.effectiveAt))[0];
      checks.push(
        check(
          'DDIVx D1 shows the corrected value as revision 2, with the correction time',
          d1 !== undefined && d1.revision === 2 && d1.correctedAt !== null && d1.usd !== null && firstSyncD1Usd !== null && !Rational.fromDecimal(d1.usd).eq(Rational.fromDecimal(firstSyncD1Usd)),
          `${describeEntry(d1)}; was USD ${firstSyncD1Usd} (activation ${new Date(Number(d1Activation) * 1000).toISOString()})`,
          'Issuer corrections (STRCx c5721924 had several revisions)',
        ),
      );

      const reversal = rows.find((j) => j.entryType === 'reversal' && j.changeReason === 'issuer_correction' && j.issuerEventId === scenario.correctedEventId);
      const replacement = rows.find((j) => j.entryType === 'recognition' && j.issuerEventId === scenario.correctedEventId && j.issuerRevision === 2);
      checks.push(
        check(
          'The correction is journaled as a reversal plus a replacement',
          reversal !== undefined && replacement !== undefined,
          `reversal ${reversal ? `#${reversal.id} of #${reversal.reversesId}` : 'missing'}; replacement ${replacement ? `#${replacement.id}` : 'missing'}`,
          'Corrections never rewrite history (ADR-0003)',
        ),
      );
      const stillThere = firstSyncJournal.every((old) => {
        const now = rows.find((j) => j.id === old.id);
        return now !== undefined && now.entryType === old.entryType && now.usd === old.usd && now.issuerRevision === old.issuerRevision;
      });
      checks.push(check('Every earlier journal row is still present and unchanged', stillThere, `${firstSyncJournal.length} earlier rows, ${rows.length} now`, 'Append-only journal'));

      const lateEventId = scenario.laterActions.find((a) => a.version === 1)?.eventId;
      const lateRecognition = rows.find((j) => j.entryType === 'recognition' && j.kind === 'dividend' && j.issuerEventId === lateEventId);
      checks.push(
        check(
          'DDIVx D7 is recognized once its issuer record arrives',
          lateRecognition !== undefined,
          lateRecognition ? `recognition #${lateRecognition.id}, USD ${lateRecognition.usd}` : 'no dividend recognition for the late record',
          'Late ingestion replays deterministically',
        ),
      );

      const ddiv = position(p, 'DDIVx');
      checks.push(
        check('Conversion is paused for review after the correction', ddiv !== undefined && includes(ddiv.conversionDisabledReasons, 'issuer corrected'), ddiv?.conversionDisabledReasons.join('; ') ?? 'no position'),
      );

      const csv = (await api.request(`/v1/export?owner=${owner}&dataset=journal`)).body;
      const lines = csv.split('\r\n').filter(Boolean);
      checks.push(
        check(
          'The journal CSV carries every journal row, each labelled synthetic',
          lines.length === rows.length + 1 && lines.slice(1).every((l) => l.startsWith('synthetic,')),
          `${lines.length - 1} CSV rows, ${rows.length} journal rows`,
        ),
      );
      return checks;
    },

    determinism(before: LedgerSnapshot, after: LedgerSnapshot): Check[] {
      return [
        check('Re-running the sync appends no journal rows', before.journalRows === after.journalRows, `${before.journalRows} → ${after.journalRows}`),
        check('Re-running the sync reproduces every income entry exactly', before.income === after.income, before.income === after.income ? 'identical' : 'income entries differ'),
        check('Re-running the sync reproduces every position exactly', before.portfolio === after.portfolio, before.portfolio === after.portfolio ? 'identical' : 'positions differ'),
      ];
    },

    async providerDisagreement(account: string, before: LedgerSnapshot): Promise<Check[]> {
      const p = await portfolio();
      const provider = await latestBalanceCheck();
      const after = await snapshot();
      const agreement = await opsCheck('provider_agreement');
      const ddiv = position(p, 'DDIVx');
      const dpar = position(p, 'DPARx');
      return [
        check(
          'A second provider reporting a different balance is recorded as a disagreement',
          provider?.outcome === 'disagree' && provider.details.some((d) => d.account === account),
          `latest check: ${provider?.outcome ?? 'none'}; ${provider?.details.map((d) => `primary ${d.primaryRaw}, independent ${d.secondaryRaw}`).join('; ') ?? ''}`,
          'PLAN Appendix B: primary plus independent reconciliation RPC; pause on source disagreement',
        ),
        check(
          'Conversion is paused for the affected position only',
          ddiv !== undefined && includes(ddiv.conversionDisabledReasons, 'independent RPC provider') && dpar !== undefined && !includes(dpar.conversionDisabledReasons, 'independent RPC provider'),
          `DDIVx: ${ddiv?.conversionDisabledReasons.join('; ')} | DPARx: ${dpar?.conversionDisabledReasons.join('; ')}`,
        ),
        check(
          'Reads stay available and the ledger is untouched',
          before.journalRows === after.journalRows && before.income === after.income && before.portfolio === after.portfolio,
          `journal ${before.journalRows} → ${after.journalRows}; income and positions ${before.income === after.income && before.portfolio === after.portfolio ? 'identical' : 'changed'}`,
        ),
        check('Monitoring reports the disagreement as critical', agreement?.status === 'critical', agreement?.message ?? 'no provider_agreement check'),
      ];
    },

    async providersAgreeAgain(): Promise<Check[]> {
      const p = await portfolio();
      const provider = await latestBalanceCheck();
      const agreement = await opsCheck('provider_agreement');
      const ddiv = position(p, 'DDIVx');
      return [
        check(
          'Once the providers agree again, the pause lifts',
          provider?.outcome === 'agree' && ddiv !== undefined && !includes(ddiv.conversionDisabledReasons, 'independent RPC provider'),
          `latest check: ${provider?.outcome ?? 'none'}; DDIVx: ${ddiv?.conversionDisabledReasons.join('; ')}`,
        ),
        check('Monitoring no longer reports a disagreement', agreement !== undefined && agreement.status !== 'critical', `${agreement?.status}: ${agreement?.message}`),
      ];
    },
  };
}
