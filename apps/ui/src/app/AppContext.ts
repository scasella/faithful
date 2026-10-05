import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { Adapter } from '../actions';
import type { Store } from '../store';

export interface AppCtx {
  store: Store;
  adapter: Adapter;
}

export const AppContext = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
  const c = useContext(AppContext);
  if (!c) throw new Error('useApp outside <AppContext.Provider>');
  return c;
}
