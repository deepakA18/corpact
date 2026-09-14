import { describe, expect, it } from 'vitest';
import { CORPORATE_ACTION_TYPES } from './actions';
import { ACTION_KINDS, ACTION_KIND_SPECS, actionKindForIssuerType } from './taxonomy';

describe('action taxonomy', () => {
  it('maps every issuer caType to a kind', () => {
    for (const type of CORPORATE_ACTION_TYPES) expect(ACTION_KINDS).toContain(actionKindForIssuerType(type));
  });

  it('never presents a classifier with zero real instances as validated', () => {
    for (const kind of ACTION_KINDS) {
      const spec = ACTION_KIND_SPECS[kind];
      expect(spec.kind).toBe(kind);
      if (spec.realInstances === 0) expect(spec.classifier).not.toBe('validated');
    }
  });

  it('books nothing for a kind whose classifier is not built', () => {
    for (const kind of ACTION_KINDS) {
      const spec = ACTION_KIND_SPECS[kind];
      if (spec.classifier === 'not_built') expect(spec.treatment).toBe('not_booked');
    }
  });
});
