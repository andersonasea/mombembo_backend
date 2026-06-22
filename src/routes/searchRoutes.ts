import express from "express";
import { getRouteLocations, searchTrips } from "../controllers/searchController.js";

const router = express.Router();

router.get("/locations", getRouteLocations);
router.get("/trips", searchTrips);

export default router;
