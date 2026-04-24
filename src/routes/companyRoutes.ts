import express from "express";
import { getAllCompanies,createCompany,deleteCompany,updateCompany } from "../controllers/companyController.js";

const router = express.Router();
router.get("/", getAllCompanies);
router.post("/",createCompany)
router.delete("/:id",deleteCompany)
router.patch("/:id",updateCompany)
export default router;