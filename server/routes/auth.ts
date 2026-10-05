import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { getMongoDB } from "../db/mongodb.js";
import { requireAuth } from "../middleware/requireAuth.js";
const router = Router();

const attempts = new Map<string, { n: number; reset: number }>();
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;
function tooMany(ip: string): boolean {
  const now = Date.now();
  const a = attempts.get(ip);
  if (!a || a.reset < now) {
    attempts.set(ip, { n: 1, reset: now + WINDOW_MS });
    return false;
  }
  a.n++;
  return a.n > MAX_ATTEMPTS;
}



router.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: "Email and password are required"
      });
    }

    const db = getMongoDB();

    const user = await db.collection("users").findOne({
      email: email.toLowerCase().trim()
    });

    if (!user) {
      return res.status(401).json({
        error: "Invalid email or password"
      });
    }

    const passwordOk = await bcrypt.compare(
      String(password),
      String(user.passwordHash || "")
    );

    if (!passwordOk) {
      return res.status(401).json({
        error: "Invalid email or password"
      });
    }

        const jwtSecret = process.env.JWT_SECRET;

    if (!jwtSecret) {
      console.error("JWT_SECRET is not configured");
      return res.status(500).json({
        error: "Authentication configuration error"
      });
    }

    const token = jwt.sign(
      {
        userId: user._id.toString(),
        email: user.email,
        role: user.role || "user"
      },
      jwtSecret,
      {
        expiresIn: "7d"
      }
    );

    return res.json({
      success: true,
      token,
      user: {
        id: user._id,
        email: user.email,
        role: user.role || "user"
      }
    });

  } catch (error) {
    console.error("Login error:", error);

    return res.status(500).json({
      error: "Login failed"
    });
  }
});

router.get("/auth/me", requireAuth, (req, res) => {
  return res.json({
    success: true,
    user: {
      id: req.user!.userId,
      email: req.user!.email,
      role: req.user!.role
    }
  });
});

export default router;
