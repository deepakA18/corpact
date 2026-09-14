import type { CorporateActionStatus, CorporateActionType } from './actions';

/**
 * Action lifecycle: announced → confirmed → activated → (corrected | reversed | superseded).
 * The history is append-only: a step is only ever added, never edited, and only along allowed transitions.
 * Issuer revisions before activation are recorded as steps of their own (announced → announced,
 * confirmed → confirmed), so type churn such as SCCOx's is kept, not collapsed.
 */
export const LIFECYCLE_STATES = ['announced', 'confirmed', 'activated', 'corrected', 'reversed', 'superseded'] as const;
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

const NEXT: Readonly<Record<LifecycleState, readonly LifecycleState[]>> = {
  // An immediate (backdated) chain write activates with no separate confirmation.
  announced: ['announced', 'confirmed', 'activated', 'superseded', 'reversed'],
  confirmed: ['confirmed', 'activated', 'superseded', 'reversed'],
  activated: ['corrected', 'reversed'],
  corrected: ['corrected', 'reversed'],
  reversed: [],
  superseded: [],
};
/** Evidence can begin at any of these: a late issuer record means the chain was seen first. */
const INITIAL: readonly LifecycleState[] = ['announced', 'confirmed', 'activated'];

export const canTransition = (from: LifecycleState, to: LifecycleState): boolean => NEXT[from].includes(to);
export const isTerminal = (state: LifecycleState): boolean => NEXT[state].length === 0;

export interface EvidenceRef {
  source: 'issuer' | 'chain' | 'ledger';
  /** Issuer event id and revision, transaction signature, or journal row. */
  reference: string;
  /** Hash of the stored evidence, when there is one. */
  sha256: string | null;
}

export interface LifecycleStep {
  state: LifecycleState;
  at: Date;
  reason: string;
  evidence: EvidenceRef | null;
  /** For a step taken because the issuer published a revision: which one, and which earlier revision it supersedes. */
  revision?: { version: number; status: CorporateActionStatus; type: CorporateActionType; supersedes: number | null };
}

/** The distinct timestamps of PLAN §5.1. Null when that evidence does not exist. */
export interface ActionTimestamps {
  issuerEffectiveAt: Date | null;
  issuerCreatedAt: Date | null;
  configuredActivationAt: Date | null;
  publicationBlockTime: Date | null;
  firstObservedActiveAt: Date | null;
  ingestedAt: Date | null;
}

export class LifecycleError extends Error {
  override name = 'LifecycleError';
}

export function appendLifecycle(history: readonly LifecycleStep[], step: LifecycleStep): LifecycleStep[] {
  const last = history.at(-1);
  if (!last) {
    if (!INITIAL.includes(step.state)) throw new LifecycleError(`A lifecycle cannot begin as ${step.state}`);
  } else {
    if (!canTransition(last.state, step.state)) throw new LifecycleError(`Cannot move from ${last.state} to ${step.state}`);
    if (step.at.getTime() < last.at.getTime()) throw new LifecycleError(`${step.state} at ${step.at.toISOString()} precedes ${last.state} at ${last.at.toISOString()}`);
  }
  return [...history, step];
}

export const currentState = (history: readonly LifecycleStep[]): LifecycleState | null => history.at(-1)?.state ?? null;

export interface IssuerRevision {
  version: number;
  type: CorporateActionType;
  status: CorporateActionStatus;
  createdAt: Date;
  notes: string | null;
  sha256: string | null;
}

export interface LifecycleEvidence {
  issuer: { eventId: string; revisions: readonly IssuerRevision[] } | null;
  chain: {
    signature: string;
    status: 'scheduled' | 'active' | 'superseded' | 'orphaned';
    /** Block time of the write; null when only the activation is known (e.g. from the issuer's multiplier history). */
    publishedAt: Date | null;
    activatedAt: Date | null;
    /** For a superseded schedule, when the replacing write was published. */
    supersededAt: Date | null;
  } | null;
  /** When a changed interpretation was journaled after activation. */
  correctedAt: Date | null;
  /** When a recognition was reversed with no replacement, e.g. the issuer cancelled after activation. */
  reversedAt: Date | null;
}

const describeRevision = (r: IssuerRevision) =>
  `issuer v${r.version} ${r.status} ${r.type}${r.notes ? `: ${r.notes.trim()}` : ''}`;

/**
 * Which earlier revision each revision supersedes. A cancellation supersedes the version it names
 * ("[CANCELLED v4]") or, naming none, the last live one; any other revision supersedes the last live one.
 */
export function supersededRevisions(revisions: readonly IssuerRevision[]): Map<number, number | null> {
  const result = new Map<number, number | null>();
  let live: number | null = null;
  for (const r of [...revisions].sort((a, b) => a.version - b.version)) {
    if (r.status === 'Cancelled') {
      const named = /\[CANCELLED v(\d+)\]/i.exec(r.notes ?? '');
      const target: number | null = named ? Number(named[1]) : live;
      result.set(r.version, target);
      if (target === live) live = null;
    } else {
      result.set(r.version, live);
      live = r.version;
    }
  }
  return result;
}

/** Revisions neither cancelled nor superseded by a later one. */
function liveRevisions(revisions: readonly IssuerRevision[], supersedes: ReadonlyMap<number, number | null>): Set<number> {
  const live = new Set<number>();
  for (const r of [...revisions].sort((a, b) => a.version - b.version)) {
    const replaced = supersedes.get(r.version);
    if (replaced !== null && replaced !== undefined) live.delete(replaced);
    if (r.status !== 'Cancelled') live.add(r.version);
  }
  return live;
}

/** Derive the lifecycle from stored evidence. Pure; the same evidence always yields the same history. */
export function deriveLifecycle(e: LifecycleEvidence): LifecycleStep[] {
  let history: LifecycleStep[] = [];
  const add = (state: LifecycleState, at: Date, reason: string, evidence: EvidenceRef | null, revision?: LifecycleStep['revision']) => {
    history = appendLifecycle(history, { state, at, reason, evidence, ...(revision ? { revision } : {}) });
  };
  const chainRef: EvidenceRef | null = e.chain ? { source: 'chain', reference: e.chain.signature, sha256: null } : null;
  const revisions = [...(e.issuer?.revisions ?? [])].sort((a, b) => a.version - b.version);
  const supersedes = supersededRevisions(revisions);
  const issuerRef = (r: IssuerRevision): EvidenceRef => ({ source: 'issuer', reference: `${e.issuer!.eventId} v${r.version}`, sha256: r.sha256 });
  const revisionOf = (r: IssuerRevision) => ({ version: r.version, status: r.status, type: r.type, supersedes: supersedes.get(r.version) ?? null });
  const revisionReason = (r: IssuerRevision, first: boolean) => {
    const replaced = supersedes.get(r.version);
    const verb = r.status === 'Cancelled' ? 'cancelled' : first ? 'published' : 'revised';
    return `The issuer ${verb} the action${replaced ? `, superseding v${replaced}` : ''} (${describeRevision(r)})`;
  };
  const activation = e.chain?.activatedAt ?? null;
  const publishedAt = e.chain?.publishedAt ?? activation;

  // Revisions published before the chain activated are lifecycle steps; a record that only arrived later is evidence, not a state.
  // Steps follow publication time; supersession follows version order. The two can disagree across the issuer's feeds.
  const beforeActivation = revisions
    .filter((r) => activation === null || r.createdAt.getTime() <= activation.getTime())
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.version - b.version);
  const beforeChain = beforeActivation.filter((r) => publishedAt === null || r.createdAt.getTime() <= publishedAt.getTime());
  const afterChain = beforeActivation.filter((r) => publishedAt !== null && r.createdAt.getTime() > publishedAt.getTime());

  beforeChain.forEach((r, i) => add('announced', r.createdAt, revisionReason(r, i === 0), issuerRef(r), revisionOf(r)));

  if (e.chain) {
    const immediate = e.chain.publishedAt === null || (e.chain.activatedAt !== null && e.chain.activatedAt.getTime() === e.chain.publishedAt.getTime());
    if (!immediate) add('confirmed', e.chain.publishedAt!, 'The multiplier change was scheduled on chain', chainRef);
    if (!immediate) for (const r of afterChain) add('confirmed', r.createdAt, `${revisionReason(r, false)} after scheduling`, issuerRef(r), revisionOf(r));
    if (e.chain.status === 'superseded') {
      add('superseded', e.chain.supersededAt ?? e.chain.publishedAt ?? new Date(0), 'A later write replaced the schedule before it activated', chainRef);
      return history;
    }
    if (e.chain.activatedAt && (e.chain.status === 'active' || e.chain.status === 'orphaned')) {
      const how = e.chain.publishedAt === null ? 'The multiplier change became live' : immediate ? 'The multiplier change applied at publication' : 'The scheduled multiplier became live';
      add('activated', e.chain.activatedAt, how, chainRef);
    }
  }

  const last = revisions.at(-1);
  const state = currentState(history);
  if (!e.chain && last?.status === 'Cancelled' && (state === 'announced' || state === null) && liveRevisions(revisions, supersedes).size === 0) {
    add('reversed', last.createdAt, `The issuer cancelled the action before anything happened on chain (${describeRevision(last)})`, issuerRef(last));
    return history;
  }
  if (e.correctedAt && (state === 'activated' || state === 'corrected')) {
    add('corrected', e.correctedAt, 'Issuer evidence changed the interpretation; journaled as reversal and replacement', { source: 'ledger', reference: 'journal', sha256: null });
  }
  if (e.reversedAt && !isTerminal(currentState(history) ?? 'announced')) {
    add('reversed', e.reversedAt, 'The recognition was reversed with no replacement', { source: 'ledger', reference: 'journal', sha256: null });
  }
  return history;
}
