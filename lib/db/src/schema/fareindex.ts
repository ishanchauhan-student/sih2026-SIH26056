import {
  date,
  doublePrecision,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const fareindexRoutesTable = pgTable("fareindex_routes", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  origin: text("origin").notNull(),
  destination: text("destination").notNull(),
  weight: doublePrecision("weight").notNull(),
  baseFare: doublePrecision("base_fare").notNull(),
});

export const fareindexObservationsTable = pgTable("fareindex_observations", {
  id: serial("id").primaryKey(),
  routeId: integer("route_id")
    .notNull()
    .references(() => fareindexRoutesTable.id),
  fare: doublePrecision("fare").notNull(),
  observedDate: date("observed_date", { mode: "string" }).notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  bookingWindow: text("booking_window").notNull().default("T-30"),
});

export const fareindexHistoryTable = pgTable("fareindex_history", {
  id: serial("id").primaryKey(),
  observedDate: date("observed_date", { mode: "string" }).notNull().unique(),
  indexValue: doublePrecision("index_value").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertFareindexRouteSchema = createInsertSchema(
  fareindexRoutesTable,
).omit({ id: true });
export const insertFareindexObservationSchema = createInsertSchema(
  fareindexObservationsTable,
).omit({ id: true, observedAt: true });
export const insertFareindexHistorySchema = createInsertSchema(
  fareindexHistoryTable,
).omit({ id: true, createdAt: true });

export type FareindexRoute = z.infer<typeof insertFareindexRouteSchema>;
export type FareindexObservation = z.infer<
  typeof insertFareindexObservationSchema
>;
export type FareindexHistory = z.infer<typeof insertFareindexHistorySchema>;