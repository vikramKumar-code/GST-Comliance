// E2E child processes receive an explicit environment and must never load Backend/.env.
const Module = require('node:module');
const originalLoad = Module._load;

Module._load = function loadWithoutDotenv(request, parent, isMain) {
  if (request === 'dotenv') {
    return { config: () => ({ parsed: {} }) };
  }
  return originalLoad.call(this, request, parent, isMain);
};
