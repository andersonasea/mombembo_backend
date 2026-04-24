import express from "express"
import { createBooking, getAllBookings, getBookingbyId } from "../controllers/bookingsController.js";

const router=express.Router();

router.get("/",getAllBookings)
router.get("/:id",getBookingbyId)
router.post("/",createBooking)

export default router