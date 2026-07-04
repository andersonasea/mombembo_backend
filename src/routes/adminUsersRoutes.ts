import express from "express";
import { listAdminUsers } from "../controllers/adminUsersController.js";

const router = express.Router();

router.get("/", listAdminUsers);

export default router;
