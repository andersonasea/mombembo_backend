import express from "express";
import {
  createCompanyAdmin,
  deleteCompanyAdmin,
  listCompanyAdmins,
  updateCompanyAdmin,
} from "../controllers/companyAdminsController.js";

const router = express.Router();

router.get("/", listCompanyAdmins);
router.post("/", createCompanyAdmin);
router.patch("/:id", updateCompanyAdmin);
router.delete("/:id", deleteCompanyAdmin);

export default router;
