// Omogućuje `node -r ./scripts/register.js skripta.ts` bez dodatnih alata (Node 22 strip-types za TS bez dekoratora).
process.env.NODE_OPTIONS = [process.env.NODE_OPTIONS, '--experimental-strip-types', '--no-warnings'].filter(Boolean).join(' ');
