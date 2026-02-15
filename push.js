import ffmpegPath from "ffmpeg-static";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

const streamKey = "cam1";
const inputFile = path.join(process.cwd(), "test.mp4");

let args;
if (fs.existsSync(inputFile)) {
  args = [
    "-re",
    "-i",
    inputFile,
    "-c",
    "copy",
    "-f",
    "flv",
    `rtmp://127.0.0.1:1935/live/${streamKey}`,
  ];
} else {
  args = [
    "-re",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=1280x720:rate=30",
    "-re",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=1000:sample_rate=44100",
    "-loglevel",
    "debug",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-tune",
    "zerolatency",
    "-b:v",
    "1500k",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-ar",
    "44100",
    "-ac",
    "2",
    "-f",
    "flv",
    `rtmp://127.0.0.1:1935/live/${streamKey}`,
  ];
}

console.log("Spawn ffmpeg:", ffmpegPath);
console.log(args.join(" "));

const p = spawn(ffmpegPath, args, { stdio: "inherit" });
p.on("close", (c, s) => console.log("push ffmpeg closed", c, s));
p.on("error", (e) => console.error("push ffmpeg error", e));
