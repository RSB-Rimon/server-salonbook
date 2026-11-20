import express from "express";
import cors from "cors";
import "dotenv/config";
import { MongoClient } from "mongodb";
import { createAuthMiddleware } from "./auth-middleware.js";
import { createServicesRouter } from "./routes/services.js";

const app = express();
const port = Number(process.env.PORT) || 5000;
const clientUrl = process.env.CLIENT_URL || "http://localhost:3000";
const mongoUri = process.env.MONGODB_URI;

if (!mongoUri) {
  throw new Error("MONGODB_URI is missing from the environment.");
}

app.use(express.json());
app.use(cors({
  origin: clientUrl,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

const mongoClient = new MongoClient(mongoUri);

try {
  await mongoClient.connect();
  console.log("Connected to MongoDB.");
} catch {
  console.error("MongoDB connection failed.");
  process.exit(1);
}

const db = mongoClient.db("salonbookDB");
const { requireAuth, requireRole } = createAuthMiddleware(db);
app.use("/api", createServicesRouter({ db, requireAuth, requireRole }));

app.get("/", (req, res) => {
  res.send("SalonBook API is running.");
});

// Return only the signed-in user's ID and current database role.
app.get("/api/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// This route demonstrates server-side admin role protection for future admin APIs.
app.get("/api/admin/me", requireAuth, requireRole("admin"), (req, res) => {
  res.json({ user: req.user });
});

app.use((error, req, res, next) => {
  console.error("An API request failed.");
  res.status(500).json({ message: "An unexpected server error occurred." });
});

app.listen(port, () => {
  console.log("Server listening on port " + port);
});