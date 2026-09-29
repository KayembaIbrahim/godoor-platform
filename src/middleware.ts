import { proxy } from "./proxy";

/**
 * Hides the GoDoor admin portal behind an unguessable path.
 *
 * `proxy.ts` holds the logic; this file is what actually invokes it. The two
 * were split in 94b985d, but the wiring was never added back, so the admin
 * secret path silently served the public homepage and every `/api/admin/*`
 * route 404'd for anonymous visitors. Restoring it is the whole fix.
 */
export default proxy;
