# Faithful

Point it at a TypeScript function. Agree on what it does. Have a model make it faster while Lean 4 checks that every candidate still does exactly that.

Provably the same, measurably faster, and the tool never rounds up a claim.

> Work in progress. See `docs/DESIGN.md` for the contract each package is built against and `faithful doctor` for toolchain status.

```
pnpm install && pnpm build
node packages/cli/dist/bin.js doctor
```
