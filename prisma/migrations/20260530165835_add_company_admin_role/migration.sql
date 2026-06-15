-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'COMPANY_ADMIN';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "companyId" TEXT;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "transport_companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
