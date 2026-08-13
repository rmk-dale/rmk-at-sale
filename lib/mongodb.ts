import { MongoClient, Db } from "mongodb";
import dns from "dns";

// Fix for querySrv ECONNREFUSED issues on certain Windows environments
try {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
} catch (e) {
  // Ignore in environments where this isn't allowed
}

const uri = process.env.MONGODB_URI;

if (!uri) {
  throw new Error("MONGODB_URI is not defined in environment variables.");
}

// We deploy to Vercel, where every concurrent request can be served by a
// separate serverless function container — each with its own MongoClient
// and its own pool. maxPoolSize is therefore a per-container budget, not a
// global one: keep it low so N concurrent containers can't multiply past
// Atlas M0's 500-connection cap. maxIdleTimeMS releases connections quickly
// so frozen/recycled containers don't leave stale connections counted
// against that cap. serverSelectionTimeoutMS/socketTimeoutMS make slow
// queries fail fast instead of hanging into (and past) the function's own
// execution timeout while holding a pool slot.
// Command monitoring is off unless MONGO_DEBUG_COMMANDS=1, because the
// driver emits an event per command and that is not free. Turning it on
// lets a script count exactly how many operations a code path sends to
// Atlas — which is the only honest way to check whether a cache is doing
// anything. See scripts/check-admin-cache.ts.
const monitorCommands = process.env.MONGO_DEBUG_COMMANDS === "1";

const clientOptions = {
  maxPoolSize: 5,
  minPoolSize: 0,
  maxIdleTimeMS: 10_000,
  serverSelectionTimeoutMS: 5_000,
  socketTimeoutMS: 20_000,
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
