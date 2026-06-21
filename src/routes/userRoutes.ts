import express from "express";
import { getCurrentUser, updateCurrentUser } from "../controllers/usersController.js";

const router = express.Router();

router.get("/me", (req, res) => getCurrentUser(req, res));
router.patch("/me", (req, res) => updateCurrentUser(req, res));

export default router;
