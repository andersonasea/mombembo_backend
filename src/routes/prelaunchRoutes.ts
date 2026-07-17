import express, { type NextFunction, type Request, type Response } from "express";
import { createPrelaunchLead } from "../controllers/prelaunchController.js";

const router = express.Router();
const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 10 * 60 * 1_000;
const MAX_ATTEMPTS = 5;

function limitLeadSubmissions(req: Request, res: Response, next: NextFunction) {
  const now = Date.now();
  const key = req.ip ?? req.socket.remoteAddress ?? "unknown";
  const current = attempts.get(key);

  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return next();
  }

  if (current.count >= MAX_ATTEMPTS) {
    return res.status(429).json({
      error: {
        code: "TOO_MANY_REQUESTS",
        message: "Trop de tentatives. Réessayez dans quelques minutes.",
      },
    });
  }

  current.count += 1;
  return next();
}

router.post("/leads", limitLeadSubmissions, createPrelaunchLead);

export default router;
