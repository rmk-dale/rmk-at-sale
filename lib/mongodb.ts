import { MongoClient, Db } from 'mongodb';

const uri = process.env.MONGODB_URI;

if (!uri) {
  throw new Error('MONGODB_URI is not defined in environment variables.');
}

// In development, Next.js hot-reloads modules on every save, which would
// otherwise open a brand new MongoClient (and a brand new connection pool)
// each time this file is re-evaluated. Caching the client promise on
// `globalThis` survives module reloads and keeps a single pool for the
// life of the dev server. In production there's only ever one module
// evaluation, so this is just a plain singleton.
declare global {
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

let clientPromise: Promise<MongoClient>;

if (process.env.NODE_ENV === 'development') {
  if (!global._mongoClientPromise) {
    const client = new MongoClient(uri);
    global._mongoClientPromise = client.connect();
  }
  clientPromise = global._mongoClientPromise;
} else {
  const client = new MongoClient(uri);
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
