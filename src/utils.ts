import { Readable, Writable } from "stream";

// A helper class to create a ReadableStream from a Node.js-style push-based source.
export class Pushable<T> {
  read_controller: ReadableStreamDefaultController<T> | null = null;
  stream: ReadableStream<T>;

  constructor() {
    this.stream = new ReadableStream({
      start: (controller) => {
        this.read_controller = controller;
      },
    });
  }

  push(chunk: T) {
    if (this.read_controller) {
      this.read_controller.enqueue(chunk);
    } else {
      throw new Error("Stream not started");
    }
  }

  close() {
    if (this.read_controller) {
      this.read_controller.close();
    } else {
      throw new Error("Stream not started");
    }
  }
}

// Converts a Node.js Writable stream to a Web WritableStream.
export function nodeToWebWritable(
  writable: Writable,
): WritableStream<Uint8Array> {
  return new WritableStream({
    write(chunk) {
      return new Promise((resolve, reject) => {
        writable.write(chunk, (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    },
    close() {
      return new Promise((resolve) => {
        writable.end(resolve);
      });
    },
    abort(err) {
      writable.destroy(err);
    },
  });
}

// Converts a Node.js Readable stream to a Web ReadableStream.
export function nodeToWebReadable(
  readable: Readable,
): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      readable.on("data", (chunk) => {
        controller.enqueue(chunk);
      });
      readable.on("end", () => {
        controller.close();
      });
      readable.on("error", (err) => {
        controller.error(err);
      });
    },
    cancel() {
      readable.destroy();
    },
  });
}

// A utility function to assert that a certain code path is unreachable.
export function unreachable(v: never): never {
  throw new Error("unreachable");
}
