import type { Express } from "express";
import swaggerUi from "swagger-ui-express";

type OpenApiOperation = {
  tags?: string[];
  summary: string;
  security?: Array<{ bearerAuth: [] }>;
  parameters?: Array<Record<string, unknown>>;
  requestBody?: {
    required?: boolean;
    content: {
      "application/json": {
        schema: Record<string, unknown>;
      };
    };
  };
  responses: Record<string, { description: string }>;
};

export function buildOpenApiSpec(publicApiBaseUrl: string) {
  return {
    openapi: "3.0.3",
    info: {
      title: "Mobembo API",
      version: "1.0.0",
      description: "REST API for Mobembo web and mobile clients.",
    },
    servers: [
      { url: `${publicApiBaseUrl}/api/v1`, description: "Versioned API (recommended)" },
      { url: `${publicApiBaseUrl}/api`, description: "Legacy compatibility alias" },
    ],
    tags: [
      { name: "Health" },
      { name: "Auth" },
      { name: "Companies" },
      { name: "Buses" },
      { name: "Routes" },
      { name: "Schedules" },
      { name: "Bookings" },
      { name: "Payments" },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
      schemas: {
        ApiError: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                code: { type: "string" },
                message: { type: "string" },
                details: {},
              },
              required: ["code", "message"],
            },
          },
        },
      },
    },
    paths: {
      "/health": {
        get: {
          tags: ["Health"],
          summary: "Check API health",
          responses: {
            "200": { description: "API is healthy" },
          },
        } satisfies OpenApiOperation,
      },
      "/auth/register": {
        post: {
          tags: ["Auth"],
          summary: "Register a new user",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["name", "email", "password", "confirmPassword"],
                  properties: {
                    name: { type: "string" },
                    email: { type: "string" },
                    phone: { type: "string" },
                    password: { type: "string" },
                    confirmPassword: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            "201": { description: "User created" },
            "400": { description: "Validation error" },
            "409": { description: "Email already exists" },
          },
        } satisfies OpenApiOperation,
      },
      "/auth/login": {
        post: {
          tags: ["Auth"],
          summary: "Authenticate user and return JWT token",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["email", "password"],
                  properties: {
                    email: { type: "string" },
                    password: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Authentication successful" },
            "401": { description: "Invalid credentials" },
          },
        } satisfies OpenApiOperation,
      },
      "/companies": {
        get: {
          tags: ["Companies"],
          summary: "List companies",
          responses: {
            "200": { description: "Company list" },
          },
        } satisfies OpenApiOperation,
        post: {
          tags: ["Companies"],
          summary: "Create a company (admin)",
          security: [{ bearerAuth: [] }],
          responses: {
            "201": { description: "Company created" },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" },
          },
        } satisfies OpenApiOperation,
      },
      "/companies/{id}": {
        patch: {
          tags: ["Companies"],
          summary: "Update a company (admin)",
          security: [{ bearerAuth: [] }],
          parameters: [
            { in: "path", name: "id", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Company updated" },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" },
            "404": { description: "Company not found" },
          },
        } satisfies OpenApiOperation,
        delete: {
          tags: ["Companies"],
          summary: "Delete a company (admin)",
          security: [{ bearerAuth: [] }],
          parameters: [
            { in: "path", name: "id", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Company deleted" },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" },
            "404": { description: "Company not found" },
          },
        } satisfies OpenApiOperation,
      },
      "/buses": {
        get: {
          tags: ["Buses"],
          summary: "List buses",
          responses: {
            "200": { description: "Bus list" },
          },
        } satisfies OpenApiOperation,
        post: {
          tags: ["Buses"],
          summary: "Create a bus (admin)",
          security: [{ bearerAuth: [] }],
          responses: {
            "201": { description: "Bus created" },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" },
          },
        } satisfies OpenApiOperation,
      },
      "/buses/{id}": {
        patch: {
          tags: ["Buses"],
          summary: "Update a bus (admin)",
          security: [{ bearerAuth: [] }],
          parameters: [
            { in: "path", name: "id", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Bus updated" },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" },
            "404": { description: "Bus not found" },
          },
        } satisfies OpenApiOperation,
        delete: {
          tags: ["Buses"],
          summary: "Delete a bus (admin)",
          security: [{ bearerAuth: [] }],
          parameters: [
            { in: "path", name: "id", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Bus deleted" },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" },
            "404": { description: "Bus not found" },
          },
        } satisfies OpenApiOperation,
      },
      "/routes": {
        get: {
          tags: ["Routes"],
          summary: "List routes",
          responses: {
            "200": { description: "Route list" },
          },
        } satisfies OpenApiOperation,
        post: {
          tags: ["Routes"],
          summary: "Create a route (admin)",
          security: [{ bearerAuth: [] }],
          responses: {
            "201": { description: "Route created" },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" },
          },
        } satisfies OpenApiOperation,
      },
      "/routes/{id}": {
        patch: {
          tags: ["Routes"],
          summary: "Update a route (admin)",
          security: [{ bearerAuth: [] }],
          parameters: [
            { in: "path", name: "id", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Route updated" },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" },
            "404": { description: "Route not found" },
          },
        } satisfies OpenApiOperation,
        delete: {
          tags: ["Routes"],
          summary: "Delete a route (admin)",
          security: [{ bearerAuth: [] }],
          parameters: [
            { in: "path", name: "id", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Route deleted" },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" },
            "404": { description: "Route not found" },
          },
        } satisfies OpenApiOperation,
      },
      "/schedules": {
        get: {
          tags: ["Schedules"],
          summary: "List schedules",
          responses: {
            "200": { description: "Schedule list" },
          },
        } satisfies OpenApiOperation,
        post: {
          tags: ["Schedules"],
          summary: "Create a schedule (admin)",
          security: [{ bearerAuth: [] }],
          responses: {
            "201": { description: "Schedule created" },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" },
          },
        } satisfies OpenApiOperation,
      },
      "/schedules/{id}": {
        get: {
          tags: ["Schedules"],
          summary: "Get schedule by id",
          responses: {
            "200": { description: "Schedule details" },
            "404": { description: "Schedule not found" },
          },
        } satisfies OpenApiOperation,
        patch: {
          tags: ["Schedules"],
          summary: "Update a schedule (admin)",
          security: [{ bearerAuth: [] }],
          parameters: [
            { in: "path", name: "id", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Schedule updated" },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" },
            "404": { description: "Schedule not found" },
          },
        } satisfies OpenApiOperation,
        delete: {
          tags: ["Schedules"],
          summary: "Delete a schedule (admin)",
          security: [{ bearerAuth: [] }],
          parameters: [
            { in: "path", name: "id", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Schedule deleted" },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" },
            "404": { description: "Schedule not found" },
          },
        } satisfies OpenApiOperation,
      },
      "/bookings": {
        get: {
          tags: ["Bookings"],
          summary: "List bookings",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": { description: "Booking list" },
            "401": { description: "Unauthorized" },
          },
        } satisfies OpenApiOperation,
        post: {
          tags: ["Bookings"],
          summary: "Create booking",
          security: [{ bearerAuth: [] }],
          responses: {
            "201": { description: "Booking created" },
            "400": { description: "Validation/business error" },
            "401": { description: "Unauthorized" },
          },
        } satisfies OpenApiOperation,
      },
      "/bookings/{id}": {
        get: {
          tags: ["Bookings"],
          summary: "Get booking details",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": { description: "Booking details" },
            "403": { description: "Forbidden" },
            "404": { description: "Booking not found" },
          },
        } satisfies OpenApiOperation,
      },
      "/payments": {
        post: {
          tags: ["Payments"],
          summary: "Create payment for a booking",
          security: [{ bearerAuth: [] }],
          responses: {
            "201": { description: "Payment created" },
            "400": { description: "Validation/business error" },
            "401": { description: "Unauthorized" },
          },
        } satisfies OpenApiOperation,
      },
    },
  };
}

export function registerSwagger(app: Express, publicApiBaseUrl: string) {
  const openApiSpec = buildOpenApiSpec(publicApiBaseUrl);
  app.get("/docs/openapi.json", (_req, res) => res.json(openApiSpec));
  app.use("/docs", swaggerUi.serve, swaggerUi.setup(openApiSpec));
}
