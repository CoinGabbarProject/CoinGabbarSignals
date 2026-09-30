import { MongoClient, Db } from "mongodb";

const uri = process.env.MONGODB_URI;

if (!uri) {
  throw new Error("MONGODB_URI is missing");
}

const client = new MongoClient(uri);

let db: Db | null = null;

export async function connectMongoDB() {
  if (db) return db;

  await client.connect();

  db = client.db(
    process.env.MONGODB_DB || "coingabbarsignals"
  );

  console.log("[mongodb] connected");

  return db;
}

export function getMongoDB() {
  if (!db) {
    throw new Error("MongoDB is not connected");
  }

  return db;
}
