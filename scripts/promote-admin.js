import "dotenv/config";
import { MongoClient } from "mongodb";

function escapeRegex(value) {
  return value
    .replace(/[.*+?^$()|[\]\\]/g, "\\$&")
    .replace(/[{}]/g, "\\$&");
}

const adminEmail = process.env.ADMIN_EMAIL?.trim();

if (!adminEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
  console.error("Set ADMIN_EMAIL in the server .env to the account email you want to promote.");
  process.exit(1);
}

if (!process.env.MONGODB_URI) {
  console.error("MONGODB_URI is missing from the server .env.");
  process.exit(1);
}

const mongoClient = new MongoClient(process.env.MONGODB_URI);

try {
  await mongoClient.connect();

  const db = mongoClient.db("salonbookDB");
  const users = db.collection("user");
  const user = await users.findOne({
    email: new RegExp("^" + escapeRegex(adminEmail) + "$", "i"),
  });

  if (!user) {
    console.error("No SalonBook account was found for ADMIN_EMAIL. Sign up first, then run this command again.");
    process.exitCode = 1;
  } else {
    await users.updateOne(
      { _id: user._id },
      {
        $set: {
          role: "admin",
          isBlocked: false,
          updatedAt: new Date(),
        },
      }
    );

    console.log("Admin access is ready for " + user.email + ". Sign out and sign in again.");
  }
} catch {
  console.error("Could not update the admin account. Check the server .env and MongoDB connection.");
  process.exitCode = 1;
} finally {
  await mongoClient.close();
}
