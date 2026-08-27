import { createInterface } from "node:readline/promises";

import { hashOperatorPassword } from "../src/lib/session.js";

/**
 * Prints the scrypt hash to store in DASHBOARD_PASSWORD_HASH_FILE.
 * The password is read from stdin so it never lands in shell history.
 */
const readline = createInterface({ input: process.stdin, output: process.stderr });
const password = await readline.question("Operator password: ");
readline.close();

if (!password) {
  process.stderr.write("A non-empty password is required.\n");
  process.exit(1);
}

process.stdout.write(`${hashOperatorPassword(password)}\n`);
