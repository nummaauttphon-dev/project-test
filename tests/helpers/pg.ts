import pg from "pg";

export async function connect(): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  return client;
}

/** Waits until the pending RPC call to `functionName` is parked on a heavyweight lock. */
export async function waitUntilBlocked(
  observer: pg.Client,
  pending: Promise<unknown>,
  functionName: string,
): Promise<void> {
  let settled = false;
  const finished = pending.then(
    () => {
      settled = true;
      throw new Error(`${functionName} finished without blocking`);
    },
    (error: unknown) => {
      settled = true;
      throw error;
    },
  );
  const poll = async () => {
    const deadline = Date.now() + 10000;
    while (!settled && Date.now() < deadline) {
      const { rows } = await observer.query<{ n: string }>(
        `select count(*) as n from pg_stat_activity
         where wait_event_type = 'Lock' and query ilike $1`,
        [`%${functionName}%`],
      );
      if (Number(rows[0].n) > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (!settled) throw new Error(`${functionName} never blocked on a lock`);
  };
  await Promise.race([poll(), finished]);
}
