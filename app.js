import { createApp } from './server/index.js';
import { probeSupabase } from './server/supabase.js';
import { syncAllOwners } from './server/supabaseSync.js';

const app = createApp();

probeSupabase().then(async (supabase) => {
  if (supabase.configured && supabase.reachable) await syncAllOwners();
}).catch((error) => {
  console.error(error.message);
});

export default app;
