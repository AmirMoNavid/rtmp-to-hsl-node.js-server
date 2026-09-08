// src/rtmp.js (robust postPublish with retries)
import NodeMediaServer from "node-media-server";
import { spawn } from "child_process";
import ffmpegPath from "ffmpeg-static";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const hlsOutputPath = path.join(__dirname, "..", "hls");
if (!fs.existsSync(hlsOutputPath))
  fs.mkdirSync(hlsOutputPath, { recursive: true });

const active = new Map();


const SIMPLE_HLS = true;

const config = {
  rtmp: {
    port: 1935,
    chunk_size: 60000,
    gop_cache: true,
    ping: 30,
    ping_timeout: 60,
  },
  http: { port: 3080, mediaroot: hlsOutputPath, allow_origin: "*" },
};

function toFFmpegPath(p) {
  return p.replace(/\\/g, "/");
}

export default function rtmpServer() {
  const nms = new NodeMediaServer(config);
  nms.run();
  console.log("NodeMediaServer started with config:", config);

  function spawnFFmpegFor(streamKey) {
    if (!streamKey) return;
    if (active.has(streamKey)) {
      console.warn("spawnFFmpegFor: already active for", streamKey);
      return;
    }

    const streamFolder = path.join(hlsOutputPath, streamKey);
    if (!fs.existsSync(streamFolder))
      fs.mkdirSync(streamFolder, { recursive: true });

    const inputUrl = `rtmp://127.0.0.1:1935/live/${streamKey}`;

    let ffArgs;
    if (SIMPLE_HLS) {
      const outPlaylist = toFFmpegPath(
        path.join(streamFolder, `${streamKey}.m3u8`),
      );
      const segPattern = toFFmpegPath(
        path.join(streamFolder, `${streamKey}_%03d.ts`),
      );
      ffArgs = [
        "-y",
        "-loglevel",
        "debug",
        "-i",
        inputUrl,
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
        "-f",
        "hls",
        "-hls_time",
        "4",
        "-hls_list_size",
        "6",
        "-hls_flags",
        "delete_segments+independent_segments",
        "-hls_segment_filename",
        segPattern,
        outPlaylist,
      ];
    } else {
      const segmentPattern = toFFmpegPath(
        path.join(streamFolder, `${streamKey}_%v_%03d.ts`),
      );
      const variantPlaylist = toFFmpegPath(
        path.join(streamFolder, `${streamKey}_%v.m3u8`),
      );
      const masterPlaylist = toFFmpegPath(
        path.join(streamFolder, `${streamKey}_master.m3u8`),
      );
      ffArgs = [
        "-y",
        "-loglevel",
        "debug",
        "-i",
        inputUrl,
        "-filter_complex",
        "[v:0]split=3[v1][v2][v3]; [v1]scale=640:360[v1out]; [v2]scale=842:480[v2out]; [v3]scale=1280:720[v3out]; [a:0]asplit=3[a1][a2][a3]",
        "-map",
        "[v1out]",
        "-map",
        "[a1]",
        "-c:v:0",
        "libx264",
        "-preset",
        "veryfast",
        "-b:v:0",
        "800k",
        "-c:a:0",
        "aac",
        "-b:a:0",
        "96k",
        "-map",
        "[v2out]",
        "-map",
        "[a2]",
        "-c:v:1",
        "libx264",
        "-preset",
        "veryfast",
        "-b:v:1",
        "1400k",
        "-c:a:1",
        "aac",
        "-b:a:1",
        "128k",
        "-map",
        "[v3out]",
        "-map",
        "[a3]",
        "-c:v:2",
        "libx264",
        "-preset",
        "veryfast",
        "-b:v:2",
        "2800k",
        "-c:a:2",
        "aac",
        "-b:a:2",
        "192k",
        "-f",
        "hls",
        "-hls_time",
        "4",
        "-hls_list_size",
        "6",
        "-hls_flags",
        "delete_segments+independent_segments",
        "-hls_segment_filename",
        segmentPattern,
        "-master_pl_name",
        masterPlaylist,
        "-var_stream_map",
        "v:0,a:0 v:1,a:1 v:2,a:2",
        variantPlaylist,
      ];
    }

    console.log("Spawning ffmpeg for", streamKey);
    console.log("ffmpeg args:", ffArgs.join(" "));
    const ff = spawn(ffmpegPath, ffArgs, { detached: false });

    active.set(streamKey, ff);
    console.log("Spawned ffmpeg for", streamKey, "pid:", ff.pid);

    ff.stdout &&
      ff.stdout.on("data", (d) =>
        console.log(`[ffmpeg][stdout] ${d.toString()}`),
      );
    ff.stderr &&
      ff.stderr.on("data", (d) =>
        console.log(`[ffmpeg][stderr] ${d.toString()}`),
      );

    ff.on("error", (err) => {
      console.error("ffmpeg error for", streamKey, err);
      if (active.get(streamKey) === ff) active.delete(streamKey);
    });

    ff.on("close", (code, signal) => {
      console.log(
        `ffmpeg exited for ${streamKey} code=${code} signal=${signal}`,
      );
      if (active.get(streamKey) === ff) active.delete(streamKey);
    });
  }

  // robust postPublish with retry: sometimes session isn't marked publisher immediately
  nms.on("postPublish", (id, StreamPath, args) => {
    try {
      console.log(
        "postPublish raw => id:",
        id,
        "StreamPath:",
        StreamPath,
        "args:",
        args,
      );

      // helper to resolve session and spawn when ready
      const tryResolveAndSpawn = (attempt = 0) => {
        const MAX_ATTEMPTS = 5;
        const RETRY_MS = 400;

        let session = typeof id === "string" ? nms.getSession(id) : id;
        if (!session) {
          if (attempt < MAX_ATTEMPTS) {
            console.log(
              `postPublish: session not found yet, retry ${attempt + 1}/${MAX_ATTEMPTS} in ${RETRY_MS}ms`,
            );
            return setTimeout(() => tryResolveAndSpawn(attempt + 1), RETRY_MS);
          } else {
            console.warn("postPublish: session never resolved - giving up");
            return;
          }
        }

        const streamPath = StreamPath || session.streamPath;
        const streamKey = streamPath?.split?.("/")?.[2];

        if (!session.isPublisher && !streamKey) {
          if (attempt < MAX_ATTEMPTS) {
            console.log(
              `postPublish: session not marked publisher and no streamKey yet, retry ${attempt + 1}/${MAX_ATTEMPTS} in ${RETRY_MS}ms`,
            );
            return setTimeout(() => tryResolveAndSpawn(attempt + 1), RETRY_MS);
          } else {
            console.warn(
              "postPublish: session not publisher and no streamKey - giving up",
            );
            return;
          }
        }

        if (streamKey) {
          spawnFFmpegFor(streamKey);
        } else {
          console.warn(
            "postPublish: no streamKey resolved after retries - not spawning",
          );
        }
      };

      tryResolveAndSpawn(0);
    } catch (err) {
      console.error("postPublish handler error:", err);
    }
  });

  nms.on("donePublish", (id, StreamPath) => {
    console.log("donePublish => id:", id, "StreamPath:", StreamPath);
    const streamKey = (
      StreamPath ||
      (typeof id === "object" && id.streamPath) ||
      ""
    ).split?.("/")?.[2];
    if (!streamKey) return;
    const p = active.get(streamKey);
    if (p) {
      try {
        console.log("Killing ffmpeg for", streamKey);
        p.kill("SIGKILL");
      } catch (e) {
        console.warn("kill ffmpeg failed", e);
      }
      active.delete(streamKey);
    }
  });

  nms.on("prePlay", (id, StreamPath, args) =>
    console.log("prePlay =>", id && id.id ? id.id : id, StreamPath, args),
  );
  nms.on("donePlay", (id, StreamPath) =>
    console.log("donePlay =>", id && id.id ? id.id : id, StreamPath),
  );
}
