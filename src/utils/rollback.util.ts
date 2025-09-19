export type TxStep = {
  do: () => Promise<void>;
  undo: () => Promise<void>;
  label?: string;
};

export async function withPseudoTransaction(steps: TxStep[]): Promise<void> {
  const executed: TxStep[] = [];
  for (const step of steps) {
    try {
      await step.do();
      executed.push(step);
    } catch (e) {
      // Roll back in reverse order
      for (const done of executed.reverse()) {
        try { await done.undo(); } catch { /* best-effort */ }
      }
      throw e;
    }
  }
}

