import express from "express";
import { searchTrips } from "../controllers/searchController.js";

const router = express.Router();

router.get("/trips", searchTrips);

export default router;
