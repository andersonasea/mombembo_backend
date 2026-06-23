import express from "express";
import {
  getAllCompanies,
  getCompanyById,
  createCompany,
  deleteCompany,
  updateCompany,
} from "../controllers/companyController.js";

const router = express.Router();
router.get("/", getAllCompanies);
router.post("/", createCompany);
router.get("/:id", getCompanyById);
router.delete("/:id", deleteCompany);
router.patch("/:id", updateCompany);
export default router;