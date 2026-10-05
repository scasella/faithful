/** Values in the value domain (Val) and run outcomes, rendered exactly (no rounding, no locale formatting). */
import type { Outcome, Val } from '@faithful/translate';
import { valText } from '../lib/format';

export function ValueView({ v }: { v: Val }) {
  if (v === null) return <span class="val val-null" title="null: the option value none">null</span>;
  return <span class="val">{valText(v)}</span>;
}

export function OutcomeView({ o }: { o: Outcome }) {
  switch (o.tag) {
    case 'ok':
      return <ValueView v={o.value} />;
    case 'throw':
      return (
        <span>
          <span class="outcome-tag">throws</span>
          <span class="val">{JSON.stringify(o.message)}</span>
        </span>
      );
    case 'range-violation':
      return (
        <span>
          <span class="outcome-tag">leaves the integer range</span>
          <span class="val">{o.detail}</span>
        </span>
      );
    case 'fault':
      return (
        <span>
          <span class="outcome-tag">fault</span>
          <span class="val">{o.detail}</span>
        </span>
      );
  }
}
