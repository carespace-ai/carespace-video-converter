const ffmpeg = require('fluent-ffmpeg');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Prefer system ffmpeg/ffprobe (needed for hevc_videotoolbox + alpha_quality on macOS).
// GUI Electron apps on macOS don't inherit the shell PATH, so `which` alone misses
// Homebrew binaries. Check known paths explicitly before falling back.
const SYSTEM_SEARCH_PATHS = [
  '/opt/homebrew/bin',  // Apple Silicon Homebrew
  '/usr/local/bin',     // Intel Homebrew
  '/usr/bin',
  '/opt/local/bin',     // MacPorts
];

function resolveSystemBinary(name) {
  for (const dir of SYSTEM_SEARCH_PATHS) {
    const candidate = path.join(dir, name);
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // ignore and continue
    }
  }
  try {
    const systemPath = execSync(`which ${name}`, { encoding: 'utf-8' }).trim();
    if (systemPath) return systemPath;
  } catch {
    // not found on system
  }
  return null;
}

function resolveBundledPath(modulePath) {
  return modulePath.includes('app.asar')
    ? modulePath.replace('app.asar', 'app.asar.unpacked')
    : modulePath;
}

const systemFfmpeg = resolveSystemBinary('ffmpeg');
const systemFfprobe = resolveSystemBinary('ffprobe');

ffmpeg.setFfmpegPath(
  systemFfmpeg || resolveBundledPath(require('@ffmpeg-installer/ffmpeg').path)
);
ffmpeg.setFfprobePath(
  systemFfprobe || resolveBundledPath(require('@ffprobe-installer/ffprobe').path)
);

// hevc_videotoolbox (+ alpha_quality) is only available in Apple's system ffmpeg builds.
// The bundled @ffmpeg-installer/ffmpeg is a cross-platform static build that lacks it.
function hasVideoToolboxHEVC() {
  if (!systemFfmpeg) return false;
  try {
    const encoders = execSync(`"${systemFfmpeg}" -hide_banner -encoders`, { encoding: 'utf-8' });
    return /hevc_videotoolbox/.test(encoders);
  } catch {
    return false;
  }
}

const HEVC_VIDEOTOOLBOX_AVAILABLE = hasVideoToolboxHEVC();

/**
 * Probe a file to get metadata (duration, codec, pixel format, resolution)
 */
function probeFile(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);

      const video = metadata.streams.find((s) => s.codec_type === 'video');
      if (!video) return reject(new Error('No video stream found'));

      resolve({
        duration: metadata.format.duration,
        codec: video.codec_name,
        pixFmt: video.pix_fmt,
        width: video.width,
        height: video.height,
        hasAlpha: video.pix_fmt?.includes('a') || false,
        fileName: path.basename(filePath),
      });
    });
  });
}

/**
 * Convert to WebM VP9 with alpha channel
 */
function convertToWebM(inputPath, outputPath, options, onProgress) {
  const bitrate = options.bitrate || '2M';
  const crf = options.crf ?? 30;

  const command = ffmpeg(inputPath)
    .outputOptions([
      '-c:v', 'libvpx-vp9',
      '-pix_fmt', 'yuva420p',
      '-b:v', bitrate,
      '-crf', String(crf),
      '-auto-alt-ref', '0',
      '-an',
      '-deadline', 'good',
      '-cpu-used', '2',
      '-row-mt', '1',
    ])
    .output(outputPath)
    .on('progress', (info) => {
      if (onProgress && info.percent != null) {
        onProgress(Math.min(100, Math.round(info.percent)));
      }
    });

  const promise = new Promise((resolve, reject) => {
    command.on('end', () => resolve(outputPath)).on('error', (err) => reject(err));
    command.run();
  });

  return { promise, command };
}

/**
 * Convert to HEVC with alpha (Safari fallback) using videotoolbox
 */
function convertToHEVC(inputPath, outputPath, options, onProgress) {
  if (!HEVC_VIDEOTOOLBOX_AVAILABLE) {
    const message = systemFfmpeg
      ? 'HEVC alpha requires Apple hevc_videotoolbox encoder, which is missing from the installed ffmpeg. Install Apple\'s build via Homebrew: brew install ffmpeg'
      : 'HEVC alpha requires a system ffmpeg with hevc_videotoolbox (macOS only). Install via Homebrew: brew install ffmpeg';
    return {
      promise: Promise.reject(new Error(message)),
      command: null,
    };
  }

  // hevc_videotoolbox only preserves alpha when the input pixel format carries it.
  // Without an explicit -pix_fmt, ffmpeg may auto-negotiate to yuv420p and silently
  // drop the alpha channel, producing a Safari-opaque file even though -alpha_quality
  // is set. bgra is the canonical alpha-capable format accepted by the encoder.
  const command = ffmpeg(inputPath)
    .outputOptions([
      '-c:v', 'hevc_videotoolbox',
      '-allow_sw', '1',
      '-alpha_quality', '0.75',
      '-pix_fmt', 'bgra',
      '-tag:v', 'hvc1',
      '-an',
    ])
    .output(outputPath)
    .on('progress', (info) => {
      if (onProgress && info.percent != null) {
        onProgress(Math.min(100, Math.round(info.percent)));
      }
    });

  const promise = new Promise((resolve, reject) => {
    command.on('end', () => resolve(outputPath)).on('error', (err) => reject(err));
    command.run();
  });

  return { promise, command };
}

module.exports = { convertToWebM, convertToHEVC, probeFile };
