import express from "express";
import { getBookingsTrend } from "../controllers/analyticsController.js";

const router = express.Router();

router.get("/bookings-trend", (req, res) => getBookingsTrend(req, res));

export default router;
