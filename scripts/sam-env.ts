import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'dotenv';

// Keep local credentials out of the synthesized template and Lambda bundle.
const databaseUrl = parse(readFileSync('.env'))['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error('Set DATABASE_URL in .env before starting SAM.');
}

if (!URL.canParse(databaseUrl)) {
  throw new Error('DATABASE_URL must be a valid PostgreSQL connection string.');
}
const url = new URL(databaseUrl);
if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
  throw new Error('DATABASE_URL must be a PostgreSQL connection string.');
}
if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
  url.hostname = 'host.docker.internal';
  console.log('SAM will connect to Postgres on your host using host.docker.internal.');
}

const output = 'sam-env.local.json';
writeFileSync(output, JSON.stringify({ Parameters: { DATABASE_URL: url.toString() } }, null, 2), {
  mode: 0o600,
});
chmodSync(output, 0o600);
console.log(`Created ${output} for all Lambda functions. Connection details are not logged.`);
