import https from "node:https";
import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";
import { fileTypeFromBuffer } from "file-type";
import { imageSize } from "image-size";
export class ImageError extends Error {
  constructor(code) {
    super(code);
    this.permanent = true;
  }
}
export function imageURL(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new ImageError("invalid_image_url");
  }
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.port ||
    !/(^|\.)ddimg\.cn$/i.test(u.hostname)
  )
    throw new ImageError("unsupported_image_host");
  u.hash = "";
  return u;
}
export async function validateImage(bytes, config) {
  if (!bytes.length || bytes.length > config.maxImageBytes)
    throw new ImageError("image_size_limit");
  const type = await fileTypeFromBuffer(bytes);
  if (!type || !["image/jpeg", "image/png", "image/webp"].includes(type.mime))
    throw new ImageError("unsupported_image_format");
  let dimensions;
  try {
    dimensions = imageSize(bytes);
  } catch {
    throw new ImageError("invalid_image_content");
  }
  if (
    !dimensions.width ||
    !dimensions.height ||
    dimensions.width * dimensions.height > config.maxImagePixels
  )
    throw new ImageError("image_pixel_limit");
  return { bytes, mime: type.mime };
}
export async function downloadImage(raw, config, signal, redirects = 0) {
  const u = imageURL(raw);
  signal.throwIfAborted();
  const addresses = await new Promise((resolve, reject) => {
    const onAbort = () => {
      reject(new Error("aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    lookup(u.hostname, { all: true })
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", onAbort));
  });
  if (
    !addresses.length ||
    addresses.some((a) => ipaddr.process(a.address).range() !== "unicast")
  )
    throw new ImageError("unsafe_image_address");
  const selected = addresses[0];
  const bytes = await new Promise((resolve, reject) => {
    const req = https.get(
      u,
      {
        signal,
        lookup: (_host, options, cb) =>
          options?.all
            ? cb(null, [selected])
            : cb(null, selected.address, selected.family),
        headers: {
          "user-agent": "DangdangVoice/Pro image-analysis",
          accept: "image/jpeg,image/png,image/webp",
        },
      },
      (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          res.resume();
          if (redirects >= 3 || !res.headers.location)
            return reject(new ImageError("image_redirect_limit"));
          return resolve({ redirect: new URL(res.headers.location, u).href });
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(
            new ImageError(
              res.statusCode === 404 ? "image_not_found" : "image_unavailable",
            ),
          );
        }
        if (Number(res.headers["content-length"]) > config.maxImageBytes) {
          res.destroy();
          return reject(new ImageError("image_size_limit"));
        }
        const chunks = [];
        let size = 0;
        res.on("data", (c) => {
          size += c.length;
          if (size > config.maxImageBytes) {
            res.destroy(new ImageError("image_size_limit"));
            return;
          }
          chunks.push(c);
        });
        res.on("error", reject);
        res.on("end", () => resolve(Buffer.concat(chunks)));
      },
    );
    req.on("error", () =>
      reject(new Error(signal.aborted ? "aborted" : "image_download_error")),
    );
  });
  if (bytes.redirect)
    return downloadImage(bytes.redirect, config, signal, redirects + 1);
  return validateImage(bytes, config);
}
