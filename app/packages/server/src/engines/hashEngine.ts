import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

/** Streams a file and returns its lowercase hex SHA-256 digest. */
export function sha256File(absolutePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(absolutePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}
