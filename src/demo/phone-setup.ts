// The phone view of the web demo (/example/phone): the real phone app, but its requests are answered right here in the
// browser by the same code the Gnomon server runs (src/api.ts and src/phone.ts), on the demo data from storage.ts.
// Must be imported before the phone app itself.
import './clock';
import { handleApiRequest } from '../api';
import { phoneApi } from '../phone';
import { fitWorkdays } from '../fit';
import { readDemo, writeDemo } from './storage';
import { setKey, setTransport } from '../../server/web/api';
import type { Data } from '../types';

(window as { gnomonDemo?: boolean }).gnomonDemo = true;

let data: Data = readDemo();
const ctx = {
  get: () => data,
  // Like the Mac app: the workday follows the entries (src/fit.ts), then it's saved for the Mac view to pick up.
  commit: (next: Data) => {
    data = fitWorkdays(data, next).data;
    writeDemo(data);
  },
};
const phone = phoneApi(ctx);
const device = { id: 'demo', name: 'Demo phone' };

setKey('demo');
setTransport(async (method, path, body) => {
  data = readDemo(); // the Mac view in another tab may have changed it
  const [p, qs] = path.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs ?? ''));
  const r =
    method === 'GET' && p === '/me'
      ? { status: 200, body: device }
      : method === 'POST' && p === '/pair'
        ? { status: 200, body: { key: 'demo', device } }
        : method === 'DELETE' && p === '/me'
          ? { status: 200, body: { revoked: 'demo' } }
          : method === 'POST' && p === '/pair-codes'
            ? { status: 409, body: { error: 'demo', message: 'Pairing works with a real Gnomon server, not in the demo.' } }
            : (phone.route(method, p, body, device) ?? handleApiRequest(ctx, { method, path: p, query, body }));
  return { status: r.status, json: r.body as { message?: string } & Record<string, unknown> };
});
