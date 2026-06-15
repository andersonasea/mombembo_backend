import "dotenv/config";
import { Prisma, PrismaClient, Role } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hash } from "bcryptjs";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
//const prisma = new PrismaClient({ adapter });
const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL!,
  }),
});
async function main() {
  const adminPassword = await hash("admin123", 12);

  const admin = await prisma.user.upsert({
    where: { email: "admin@mobembo.com" },
    update: {},
    create: {
      name: "Administrateur",
      email: "admin@mobembo.com",
      phone: "+243000000000",
      password: adminPassword,
      role: Role.ADMIN,
    },
  });

  console.log("Admin créé:", admin.email);

  const clientPassword = await hash("client123", 12);

  const client = await prisma.user.upsert({
    where: { email: "client@test.com" },
    update: {},
    create: {
      name: "Jean Mutombo",
      email: "client@test.com",
      phone: "+243999999999",
      password: clientPassword,
      role: Role.CLIENT,
    },
  });

  console.log("Client créé:", client.email);

  const company = await prisma.transportCompany.upsert({
    where: { email: "contact@transkin.com" },
    update: {},
    create: {
      name: "TransKin Express",
      email: "contact@transkin.com",
      phone: "+243811111111",
      address: "Gare centrale, Kinshasa",
      description: "Transport interurbain de qualité depuis 2010",
    },
  });

  const bus = await prisma.bus.upsert({
    where: { plateNumber: "KIN-2024-AB" },
    update: {},
    create: {
      plateNumber: "KIN-2024-AB",
      model: "Mercedes Sprinter",
      totalSeats: 50,
      companyId: company.id,
    },
  });

  const route = await prisma.route.upsert({
    where: {
      departure_destination_companyId: {
        departure: "Kinshasa",
        destination: "Lubumbashi",
        companyId: company.id,
      },
    },
    update: {},
    create: {
      departure: "Kinshasa",
      destination: "Lubumbashi",
      price: 75000,
      durationMinutes: 180,
      companyId: company.id,
    },
  });

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(8, 0, 0, 0);

  await prisma.schedule.upsert({
    where: { id: "seed-schedule-1" },
    update: {},
    create: {
      id: "seed-schedule-1",
      routeId: route.id,
      busId: bus.id,
      departureTime: tomorrow,
      availableSeats: bus.totalSeats,
    },
  });

  const afternoonDeparture = new Date(tomorrow);
  afternoonDeparture.setHours(14, 0, 0, 0);

  await prisma.schedule.upsert({
    where: { id: "seed-schedule-2" },
    update: {},
    create: {
      id: "seed-schedule-2",
      routeId: route.id,
      busId: bus.id,
      departureTime: afternoonDeparture,
      availableSeats: bus.totalSeats,
    },
  });

  const companyAdminPassword = await hash("transkin123", 12);

  const companyAdminUpdate = {
    role: "COMPANY_ADMIN",
    companyId: company.id,
  } as unknown as Prisma.UserUncheckedUpdateInput;

  const companyAdminCreate = {
    name: "Admin TransKin Express",
    email: "admin@transkin.com",
    phone: "+243822222222",
    password: companyAdminPassword,
    role: "COMPANY_ADMIN",
    companyId: company.id,
  } as unknown as Prisma.UserUncheckedCreateInput;

  const companyAdmin = await prisma.user.upsert({
    where: { email: "admin@transkin.com" },
    update: companyAdminUpdate,
    create: companyAdminCreate,
  });

  console.log("Admin société créé:", companyAdmin.email);

  console.log("Données de démonstration créées avec succès !");
  console.log(`\nConnexion admin Mobembo: admin@mobembo.com / admin123`);
  console.log(`Connexion admin TransKin: admin@transkin.com / transkin123`);
  console.log(`Connexion client: client@test.com / client123`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
