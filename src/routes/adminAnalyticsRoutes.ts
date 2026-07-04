import express from "express";
import {
  getBookingsTrend,
  getDashboardStats,
  getPassengerDemographics,
  getUsersTrend,
} from "../controllers/analyticsController.js";

const router = express.Router();

router.get("/dashboard-stats", (req, res) => getDashboardStats(req, res));
router.get("/bookings-trend", (req, res) => getBookingsTrend(req, res));
router.get("/passenger-demographics", (req, res) => getPassengerDemographics(req, res));
router.get("/users-trend", (req, res) => getUsersTrend(req, res));

export default router;
