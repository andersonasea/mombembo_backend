import express from "express";
import { createRoute, deleteRoute, getAllRoutes, getRouteById, updateRoutes } from "../controllers/routesController.js";

const router=express.Router();

router.get("/",getAllRoutes)
router.get("/:id", getRouteById)
router.post("/",createRoute)
router.patch("/:id",updateRoutes)
router.delete("/:id",deleteRoute)

export default router