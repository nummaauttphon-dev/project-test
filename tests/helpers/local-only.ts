const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);

/**
 * Throws unless `url` points at the local stack. Test helpers wipe tables, buckets and users, so a
 * stray env pointing at a real project must stop them before any request. The message names the
 * variable only: URLs can carry a project ref or a password.
 */
export function assertLocal(name: string, url: string | undefined): void {
  let hostname = "";
  try {
    hostname = new URL(url ?? "").hostname;
  } catch {
    // Unparseable counts as not local.
  }
  if (!LOCAL_HOSTS.has(hostname)) {
    throw new Error(`Test helpers only run against the local stack: ${name} must point at 127.0.0.1 or localhost`);
  }
}
