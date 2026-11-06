import { waitForApiReady } from "../helpers/ready";

// Same readiness wait as the integration tests: after `db reset` PostgREST can serve a stale
// schema or dead connections for a few seconds, which would make the first specs flaky.
export default async function globalSetup() {
  await waitForApiReady();
}
