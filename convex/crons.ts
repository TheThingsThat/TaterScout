import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Demo cleanup. The tab-close beacon only shortens a session's expiry (and
// crashes and force-quits fire no event at all), so this is what actually
// deletes demo data and guarantees it can't accumulate. Each pass is row-budgeted and reschedules itself until the
// backlog is clear, so this only needs to notice newly expired sessions.
crons.interval("reap expired demo sessions", { minutes: 10 }, internal.demo.reapExpired, {});

export default crons;
