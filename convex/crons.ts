import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// The backstop for demo cleanup. The tab-close beacon handles the normal case,
// but crashes and force-quits fire no event — this is what guarantees demo data
// can't accumulate. Runs often because each pass is capped at 20 sessions.
crons.interval("reap expired demo sessions", { minutes: 10 }, internal.demo.reapExpired, {});

export default crons;
