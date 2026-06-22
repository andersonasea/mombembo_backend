import express from "express";
import { getBookingsTrend, getPassengerDemographics } from "../controllers/analyticsController.js";

const router = express.Router();

router.get("/bookings-trend", (req, res) => getBookingsTrend(req, res));
router.get("/passenger-demographics", (req, res) => getPassengerDemographics(req, res));

export default router;
