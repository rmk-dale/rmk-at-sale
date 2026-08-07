import { MongoClient } from "mongodb";
import dns from "dns";
try { dns.setServers(["8.8.8.8","1.1.1.1"]); } catch (e) {}
import { readFileSync, existsSync } from "fs";
import path from "path";

const ROOT = process.cwd();
function loadEnvLocal() {
  const envPath = path.join(ROOT, ".env.local");
  if (!existsSync(envPath)) return;
  const contents = readFileSync(envPath, "utf8");
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnvLocal();
const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);
await client.connect();
const products = client.db().collection("products");
const count = await products.countDocuments();
console.log("count:", count);
const sample = await products.find().limit(5).toArray();
console.log(JSON.stringify(sample, null, 2));
await client.close();
