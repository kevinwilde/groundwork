import { toast } from 'sonner';
import { applyOps, type Op } from '../data/ops';

export const notify = (message: string) => toast(message);
export const notifyError = (message: string) => toast.error(message);

/** Apply ops and report failures instead of throwing. Returns the inverse ops, or null on failure. */
export async function save(ops: Op[]): Promise<Op[] | null> {
  try {
    return await applyOps(ops);
  } catch (e) {
    console.error(e);
    notifyError(`Could not save: ${(e as Error)?.message ?? e}`);
    return null;
  }
}

/** Apply ops, then offer to reverse them. */
export async function saveWithUndo(ops: Op[], message: string) {
  const inverse = await save(ops);
  if (!inverse) return;
  toast(message, { action: { label: 'Undo', onClick: () => void save(inverse) }, duration: 6500 });
}
