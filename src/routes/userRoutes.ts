import express from "express";
import { getCurrentUser, updateCurrentUser } from "../controllers/usersController.js";
import { getMyLoyalty } from "../controllers/loyaltyController.js";

const router = express.Router();

router.get("/me", (req, res) => getCurrentUser(req, res));
router.patch("/me", (req, res) => updateCurrentUser(req, res));
router.get("/me/loyalty", (req, res) => getMyLoyalty(req, res));

export default router;
