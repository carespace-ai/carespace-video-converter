const ffmpeg = require('fluent-ffmpeg');
const { execSync } = require('child_process');
const path = require('path');

// Prefer system ffmpeg (needed for hevc_videotoolbox + alpha_quality on macOS).
// Fall back to bundled @ffmpeg-installer version if system ffmpeg not found.
function resolveFFmpegPath() {
  try {
    const systemPath = execSync('which ffmpeg', { encoding: 'utf-8' }).trim();
    if (systemPath) return systemPath;
  } catch {
    // system ffmpeg not found
  }

  const bundledPath = require('@ffmpeg-installer/ffmpeg').path;
  return bundledPath.includes('app.asar')
    ? bundledPath.replace('app.asar', 'app.asar.unpacked')
    : bundledPath;
}

ffmpeg.setFfmpegPath(resolveFFmpegPath());

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
  const command = ffmpeg(inputPath)
    .outputOptions([
      '-c:v', 'hevc_videotoolbox',
      '-allow_sw', '1',
      '-alpha_quality', '0.75',
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
