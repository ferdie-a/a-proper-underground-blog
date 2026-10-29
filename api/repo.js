import { handle } from '../server/door.js';

export function POST(request) {
  return handle(request, { env: process.env, fetch });
}
