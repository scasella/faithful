// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[["a","","bb"]],[["a","bb"]],[[]],[["a"]]]
export function f(xs: string[]): string | undefined { for (const x of xs) { if (x === "") return; if (x.length > 1) return x; } return "none"; }
