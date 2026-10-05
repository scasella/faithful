// @redteam area=strings status=held expect=refuse code=unsupported-syntax
export function refuseStringIndexKey(xs: string[]): string[] { return xs.slice().sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)); }
