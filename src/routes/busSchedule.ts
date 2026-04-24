import express from "express"
import { createSchedule, getAllSchedules, getAllSchedulesbyId, updateSchedul,deleteSchedule } from "../controllers/scheduleController.js";

const router=express.Router();

router.get("/",getAllSchedules)
router.get("/:id", getAllSchedulesbyId)
router.patch("/:id",updateSchedul)
router.post("/",createSchedule)
router.delete("/:id",deleteSchedule)

export default router
