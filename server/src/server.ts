import client from "prom-client";
import * as dotenv from "dotenv";
import express from "express";
import cors from "cors";
import { connectToDatabase } from "./database";
import { employeeRouter } from "./employee.routes";

// Load environment variables
dotenv.config();

const { DATABASE_URI } = process.env;
const PORT = Number.parseInt(process.env.PORT ?? "5300", 10);

if (!DATABASE_URI) {
  console.error(
    "No DATABASE_URI environment variable has been defined in config.env"
  );
  process.exit(1);
}

connectToDatabase(DATABASE_URI)
  .then(() => {
    const app = express();

    const register = new client.Registry();
    client.collectDefaultMetrics({ register });

    app.use(cors());

    app.get("/healthcheck", (_req, res) => {
      res.status(200).json({ status: "ok" });
    });

    app.get("/metrics", async (_req, res) => {
      res.set("Content-Type", register.contentType);
      res.end(await register.metrics());
    });

    app.use("/employees", employeeRouter);

    app.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}...`);
    });
  })
  .catch((error) => console.error(error));
