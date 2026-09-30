import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { getMongoDB } from "../db/mongodb.js";
import { requireAuth } from "../middleware/requireAuth.js";
const router = Router();



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

export default router;
