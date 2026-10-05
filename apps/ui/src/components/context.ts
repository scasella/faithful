import { createContext } from 'preact';
import type { Stamp } from '@faithful/core';

/** The session's stamp (date, model id, toolchain). Every number's provenance popover reads it. */
export const StampContext = createContext<Stamp | null>(null);
