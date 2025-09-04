import { withPseudoTransaction } from '../../../utils/rollback.util';

describe('withPseudoTransaction', () => {
  it('rolls back executed steps when a later step fails', async () => {
    const calls: string[] = [];
    const steps = [
      {
        do: async () => { calls.push('a.do'); },
        undo: async () => { calls.push('a.undo'); },
      },
      {
        do: async () => { calls.push('b.do'); throw new Error('boom'); },
        undo: async () => { calls.push('b.undo'); },
      },
    ];

    await expect(withPseudoTransaction(steps)).rejects.toThrow('boom');
    expect(calls).toEqual(['a.do', 'b.do', 'a.undo']);
  });
});

