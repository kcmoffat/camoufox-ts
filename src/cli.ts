#!/usr/bin/env node

import { cli } from "./lib/__main__";

cli().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
