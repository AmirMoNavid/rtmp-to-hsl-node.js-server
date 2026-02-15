import rtmpServer from "./rtmp.js";
import cors from "cors";
import express from "express";
import { resolve } from "path";

const app = express();
const PORT = 3000;

// const RTMP_PORT = +Number(process.env.RTMP_PORT) || 1935;

import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(resolve(__dirname, "../public")));
app.use("/hls", express.static(resolve(__dirname, "../hls")));

// app.use(require("$/router").default); // <-- Application Router

// Start the server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server started on http://0.0.0.0:${PORT}`);

  // Start the RTMP server
  rtmpServer();
});
