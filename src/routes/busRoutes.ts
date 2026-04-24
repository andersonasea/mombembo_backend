import express from "express";
import { getAllBus, createBus, deleteBus, updateBus } from "../controllers/busController.js";

const router = express.Router();

router.get("/", getAllBus);
router.post("/", createBus);
// Chemins absolus : ":id" seul est invalide, il faut "/:id" pour matcher /api/buses/xxx
router.delete("/:id", deleteBus);
router.patch("/:id", updateBus);


export default router


