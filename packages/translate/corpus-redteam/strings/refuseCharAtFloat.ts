// @redteam area=strings status=held expect=refuse code=float
export function refuseCharAtFloat(s: string): string { return s.charAt(1.5); }
