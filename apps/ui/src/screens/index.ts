import type { FunctionComponent } from 'preact';
import type { StageName } from '@faithful/session';
import type { KeyDoc } from '../app/HelpPanel';
import { SelectScreen } from './select/SelectScreen';
import { TranslateScreen } from './translate/TranslateScreen';
import { AgreeScreen } from './agree/AgreeScreen';
import { ProveScreen } from './prove/ProveScreen';
import { OptimizeScreen } from './optimize/OptimizeScreen';
import { DeliverScreen } from './deliver/DeliverScreen';

/** Screen-level keys, listed in the '?' panel for the screen being shown (every one is also shown on its control). */
export const SCREEN_KEYS: Record<StageName, KeyDoc[]> = {
  select: [
    { keys: ['/'], what: 'Find an exported function' },
    { keys: ['↑', '↓'], what: 'Move through matches (in the search field)' },
    { keys: ['Enter'], what: 'Open the highlighted function' },
    { keys: ['p'], what: 'Switch between finding and pasting a function' },
    { keys: ['u'], what: 'Use the pasted function (also Ctrl/⌘ Enter in the field)' },
  ],
  translate: [
    { keys: ['p'], what: 'A throw site: treat it as a precondition' },
    { keys: ['c'], what: 'A throw site: model it as a spec case' },
    { keys: ['n'], what: 'Propose a spec (the model writes it; you agree to it)' },
    { keys: ['1', '2'], what: 'A refused function: choose when optimizing on the Tested tier stops (time budget, target speedup)' },
    { keys: ['i'], what: 'A refused function: also generate NaN, Infinity, -Infinity and -0 as inputs' },
    { keys: ['t'], what: 'A refused function: optimize with the Tested tier only (no spec, proof or SMT check exists)' },
    { keys: ['f'], what: 'A refused function the Tested tier cannot run (its file is not self-contained): choose another function' },
  ],
  agree: [
    { keys: ['j', 'k'], what: 'Next / previous unruled challenge' },
    { keys: ['s'], what: 'Rule: the spec is wrong' },
    { keys: ['f'], what: 'Rule: my function is wrong, then x (fix it) or c (carve out)' },
    { keys: ['1–9'], what: 'After c: pick the class of inputs to carve out, by number' },
    { keys: ['Esc'], what: 'Step back in a ruling' },
    { keys: ['v'], what: 'Revise the spec (after ruling it wrong somewhere)' },
    { keys: ['n'], what: 'Ask for a new spec (when the server did not accept the latest)' },
    { keys: ['r'], what: 'Re-run the challenge' },
    { keys: ['a'], what: 'Agree (opens the only confirmation; Enter agrees, Esc cancels)' },
  ],
  prove: [
    { keys: ['p'], what: 'Prove the original within the budget' },
    { keys: ['b'], what: 'After a failed proof: try again with a larger budget' },
    { keys: ['1', '2'], what: 'Choose when optimizing stops: time budget, target speedup (asymptotic is not available in this build)' },
    { keys: ['o'], what: 'Start optimizing' },
  ],
  optimize: [
    { keys: ['x'], what: 'Stop optimizing' },
    { keys: ['a'], what: 'Accept a faster, not proved candidate (without a proof)' },
    { keys: ['d'], what: 'Write the delivery (a patch; your file is not modified)' },
  ],
  deliver: [{ keys: ['1', '2'], what: 'Copy the verify command, and the apply command when a change was delivered' }],
};

/** Stage -> screen. Screen owners replace the components; keep this map's shape. */
export const SCREENS: Record<StageName, FunctionComponent> = {
  select: SelectScreen,
  translate: TranslateScreen,
  agree: AgreeScreen,
  prove: ProveScreen,
  optimize: OptimizeScreen,
  deliver: DeliverScreen,
};
