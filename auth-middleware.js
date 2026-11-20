import { createRemoteJWKSet, jwtVerify } from "jose";
import { ObjectId } from "mongodb";

const authBaseUrl = process.env.BETTER_AUTH_URL || "http://localhost:3000";
const authPublicKeys = createRemoteJWKSet(
  new URL("/api/auth/jwks", authBaseUrl)
);

export function createAuthMiddleware(db) {
  const usersCollection = db.collection("user");

  async function requireAuth(req, res, next) {
    const authorization = req.get("authorization") || "";
    const token = authorization.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length).trim()
      : "";

    if (!token) {
      return res.status(401).json({ message: "Sign in is required." });
    }

    let userId;

    try {
      const { payload } = await jwtVerify(token, authPublicKeys, {
        issuer: authBaseUrl,
        audience: authBaseUrl,
      });

      if (typeof payload.sub !== "string" || !ObjectId.isValid(payload.sub)) {
        return res.status(401).json({ message: "The access token is invalid." });
      }

      userId = payload.sub;
    } catch {
      return res.status(401).json({ message: "The access token is invalid or expired." });
    }

    const user = await usersCollection.findOne(
      { _id: new ObjectId(userId) },
      { projection: { role: 1, isBlocked: 1 } }
    );

    if (!user) {
      return res.status(401).json({ message: "This account could not be found." });
    }

    if (user.isBlocked === true) {
      return res.status(403).json({ message: "This account is blocked." });
    }

    if (user.role !== "admin" && user.role !== "customer") {
      return res.status(403).json({ message: "This account has no valid role." });
    }

    req.user = {
      id: userId,
      role: user.role,
    };

    return next();
  }

  function requireRole(requiredRole) {
    return (req, res, next) => {
      if (!req.user) {
        return res.status(401).json({ message: "Sign in is required." });
      }

      if (req.user.role !== requiredRole) {
        return res.status(403).json({ message: "You do not have permission for this action." });
      }

      return next();
    };
  }

  return { requireAuth, requireRole };
}