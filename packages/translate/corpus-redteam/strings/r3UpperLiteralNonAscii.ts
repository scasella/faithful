// @redteam area=strings status=held
// Round 3 note: holds only vacuously. A non-ASCII literal always reaches the case map, so asciiOk (and pre) is false on every input and the model is never compared; the translator accepts a function whose precondition is unsatisfiable without saying so.
// @inputs [["a"],[""]]
export function f(s: string): string { return (s + "é").toUpperCase(); }
