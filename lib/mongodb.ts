import { MongoClient, Db } from "mongodb";
import dns from "dns";

// Fix for querySrv ECONNREFUSED issues on certain Windows environments.
//
// DEVELOPMENT ONLY, deliberately. `dns.setServers` is process-global: left
// unguarded it redirects *every* lookup the process makes — nodemailer's
// SMTP connection, the Upstash REST calls on every rate-limited request —
// through Google and Cloudflare, which adds a resolver hop to the hot path
// and makes an external DNS provider a dependency of checkout.
//
// It is also pointless in production, because the deployed MONGODB_URI is
// the explicit seedlist form (`mongodb://host1,host2,host3/?replicaSet=…`)
// and performs no SRV lookup at all. The workaround only ever mattered for
// `mongodb+srv://` on a local Windows machine, which is where it now stays.
//
// See the note on the connection string below: production should be using
// `mongodb+srv://`, at which point this guard is what keeps the fix local.
if (process.env.NODE_ENV === "development") {
  try {
    dns.setServers(["8.8.8.8", "1.1.1.1"]);
  } catch {
    // Ignore in environments where this isn't allowed
  }
}

const uri = process.env.MONGODB_URI;

if (!uri) {
  throw new Error("MONGODB_URI is not defined in environment variables.");
}

// ---------------------------------------------------------------------------
// A note on the connection string itself.
//
// Production should use the `mongodb+srv://` form. The explicit seedlist
// form hard-codes Atlas node hostnames (ac-…-shard-00-0.…mongodb.net), and
// Atlas replaces, resizes and re-provisions nodes without asking — at
// which point the app is down until somebody edits an environment
// variable. Re-discovering the replica set through SRV is the entire point
// of that scheme.
//
// Keep the seedlist form in local `.env.local` if the Windows DNS issue
// above makes SRV lookups unreliable there; that is a development problem
// and belongs in a development file.
// ---------------------------------------------------------------------------

// We deploy to Vercel, where every concurrent request can be served by a
// separate serverless function container — each with its own MongoClient
// and its own pool.
//
// The governing fact for all of these numbers: **Atlas M0 is throttled at
// roughly 100 operations per second, and that is the binding constraint —
// not the 500-connection cap.** When the throughput limit is exceeded
// Atlas throttles the network and imposes a one-second cooldown, draining
// a queue before it accepts new work, which stalls every in-flight request
// together rather than failing one cleanly. Connection counts here sit at
// a few percent of the cap and are not the thing to tune.
//
// Command monitoring is off unless MONGO_DEBUG_COMMANDS=1, because the
// driver emits an event per command and that is not free. Turning it on
// lets a script count exactly how many operations a code path sends to
// Atlas — which is the only honest way to check whether a cache is doing
// anything. See scripts/check-admin-cache.ts.
const monitorCommands = process.env.MONGO_DEBUG_COMMANDS === "1";

const clientOptions = {
  // Per-container budget, not a global one. The instinct when more people
  // need to use the site is to raise this; on a throughput-throttled tier
  // that is backwards. The pool is the only thing stopping the app from
  // queueing work at Atlas faster than Atlas will drain it, and reaching
  // that queue triggers the cooldown described above. Five is a rate
  // limiter worth keeping. Revisit after leaving the free tier.
  maxPoolSize: 5,

  // Stays at zero on purpose. Raising it to 1 would save a TLS + SCRAM
  // handshake on the first query after a container warms, which is
  // tempting — but Vercel *freezes* containers rather than killing them,
  // and a frozen container's connections stay counted against Atlas's
  // 500-connection cap until the server times them out. Zero plus a
  // bounded idle timeout is the defence against that.
  minPoolSize: 0,

  // Was 10s, which was aggressive enough to be self-defeating: a container
  // serving the storefront's 15-second ISR cadence dropped its connection
  // between almost every request and paid the handshake again. Thirty
  // seconds keeps the stale-connection protection — even fifty containers
  // holding one connection each is ~10% of the cap — while cutting that
  // churn substantially. Lower it again if Atlas's connection metric ever
  // climbs.
  maxIdleTimeMS: 30_000,

  // Make slow queries fail fast instead of hanging into (and past) the
  // function's own execution timeout while holding a pool slot.
  serverSelectionTimeoutMS: 5_000,
  socketTimeoutMS: 20_000,

  // Wire compression. BSON repeats every field name in every document, so
  // it compresses very well, and the catalogue read pulls the whole
  // products collection each time a container's cache goes cold. This
  // protects a limit that is easy to forget: M0 allows 10 GB of data
  // transfer in each direction per rolling 7 days.
  //
  // zlib rather than zstd because zlib is built into Node and needs no
  // extra dependency. Level 1 is the cheap end of the scale — most of the
  // ratio, very little CPU, which is the right trade when the CPU is
  // billed by the millisecond. If transfer ever becomes tight, `npm i
  // @mongodb-js/zstd` and switch `compressors` to ["zstd"] for a better
  // ratio at similar cost.
  compressors: ["zlib" as const],
  zlibCompressionLevel: 1 as const,

  monitorCommands,
};

// In development, Next.js hot-reloads modules on every save, which would
// otherwise open a brand new MongoClient (and a brand new connection pool)
// each time this file is re-evaluated. Caching the client promise on
// `globalThis` survives module reloads and keeps a single pool for the
// life of the dev server. In production (including each Vercel container),
// the module is evaluated once per container and reused across that
// container's warm invocations, so this is effectively a per-container
// singleton either way.
declare global {
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

let clientPromise: Promise<MongoClient>;

if (process.env.NODE_ENV === "development") {
  if (!global._mongoClientPromise) {
    const client = new MongoClient(uri, clientOptions);
    global._mongoClientPromise = client.connect();
  }
  clientPromise = global._mongoClientPromise;
} else {
  const client = new MongoClient(uri, clientOptions);
  clientPromise = client.connect();
}

export default clientPromise;

/**
 * Resolves the shared MongoClient and returns the app's database handle.
 * Pass a name only if you need to point at a database other than the
 * one encoded in MONGODB_URI.
 */
export async function getDb(dbName?: string): Promise<Db> {
  const client = await clientPromise;
  return client.db(dbName);
}
