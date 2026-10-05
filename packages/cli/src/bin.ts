#!/usr/bin/env node
import { main } from './main.js';

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e) => {
    process.stderr.write(`faithful: ${(e as Error).message}\n`);
    process.exit(1);
  },
);
