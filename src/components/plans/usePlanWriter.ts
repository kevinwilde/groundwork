import { useCallback, useEffect, useRef } from 'react';
import { useData } from '../../data/DataProvider';
import type { Op } from '../../data/ops';
import type { Data } from '../../data/snapshot';
import { db } from '../../db/db';
import type { Plan } from '../../db/types';
import { save } from '../toast';

/**
 * Writes for one plan, one at a time, each built from the plan as saved in IndexedDB rather than the
 * last render's copy: two quick taps on different sets can't both start from the same stale plan and
 * undo each other's tick. Resolves true when something was saved.
 */
export function usePlanWriter(planId: string) {
  const d = useData();
  const latest = useRef(d);
  useEffect(() => {
    latest.current = d;
  }, [d]);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  return useCallback(
    (build: (plan: Plan, d: Data) => Op[]): Promise<boolean> => {
      const run = queue.current.then(async () => {
        const plan = await db.plans.get(planId);
        if (!plan) return false;
        const ops = build(plan, latest.current);
        return ops.length > 0 && (await save(ops)) !== null;
      });
      queue.current = run.catch(() => undefined);
      return run;
    },
    [planId],
  );
}
