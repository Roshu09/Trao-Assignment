import { describe, expect, it } from "vitest";
import { rejection } from "../testing/helpers";
import { assertSafeUrl, isPrivateAddress, UrlRejectedError } from "./urlGuard";

const publicLookup = async () => ["93.184.216.34"];

describe("isPrivateAddress", () => {
  it.each([
    "127.0.0.1",
    "127.1.2.3",
    "10.0.0.5",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254", // cloud metadata endpoint
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "::",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:10.0.0.1",
  ])("treats %s as private", (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each([
    "93.184.216.34",
    "8.8.8.8",
    "172.15.0.1",
    "172.32.0.1",
    "100.63.0.1",
    "2606:2800:220:1:248:1893:25c8:1946",
    "::ffff:8.8.8.8",
  ])("treats %s as public", (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });

  it("refuses anything that is not an IP address", () => {
    expect(isPrivateAddress("not-an-ip")).toBe(true);
  });
});

describe("assertSafeUrl", () => {
  it("accepts a normal public https URL", async () => {
    const url = await assertSafeUrl("https://example.com/careers", { lookup: publicLookup });
    expect(url.hostname).toBe("example.com");
  });

  it("rejects non-http protocols", async () => {
    for (const raw of ["file:///etc/passwd", "ftp://example.com/x", "javascript:alert(1)"]) {
      const error = await rejection(assertSafeUrl(raw, { lookup: publicLookup }));
      expect(error).toBeInstanceOf(UrlRejectedError);
      expect(error.reason).toBe("BAD_PROTOCOL");
    }
  });

  it("rejects text that is not a URL", async () => {
    const error = await rejection(assertSafeUrl("not a url"));
    expect(error.reason).toBe("INVALID_URL");
  });

  it("rejects embedded credentials", async () => {
    const error = await rejection(assertSafeUrl("https://user:pass@example.com/", { lookup: publicLookup }));
    expect(error.reason).toBe("CREDENTIALS");
  });

  it("rejects private and loopback IP literals", async () => {
    for (const raw of ["http://127.0.0.1/", "http://10.1.2.3/", "http://169.254.169.254/latest", "http://[::1]/"]) {
      const error = await rejection(assertSafeUrl(raw));
      expect(error.reason).toBe("PRIVATE_ADDRESS");
    }
  });

  it("rejects a hostname that resolves to a private address", async () => {
    const error = await rejection(assertSafeUrl("http://internal.example.com/", { lookup: async () => ["10.0.0.9"] }));
    expect(error.reason).toBe("PRIVATE_ADDRESS");
  });

  it("rejects a hostname with a private address hidden among public ones", async () => {
    const error = await rejection(
      assertSafeUrl("http://sneaky.example.com/", { lookup: async () => ["93.184.216.34", "127.0.0.1"] }),
    );
    expect(error.reason).toBe("PRIVATE_ADDRESS");
  });

  it("rejects localhost by name", async () => {
    const error = await rejection(assertSafeUrl("http://localhost:8099/acme/", { lookup: async () => ["127.0.0.1"] }));
    expect(error.reason).toBe("PRIVATE_ADDRESS");
  });

  it("reports a DNS failure", async () => {
    const error = await rejection(
      assertSafeUrl("http://nope.invalid/", {
        lookup: async () => {
          throw new Error("ENOTFOUND");
        },
      }),
    );
    expect(error.reason).toBe("DNS_FAILED");
  });

  it("allows local addresses only when explicitly enabled for batch runs", async () => {
    const url = await assertSafeUrl("http://localhost:8099/acme/", { allowPrivateHosts: true });
    expect(url.port).toBe("8099");
  });

  it("still rejects bad protocols and credentials when private hosts are allowed", async () => {
    const protocol = await rejection(assertSafeUrl("file:///etc/passwd", { allowPrivateHosts: true }));
    expect(protocol.reason).toBe("BAD_PROTOCOL");
    const creds = await rejection(assertSafeUrl("http://a:b@localhost/", { allowPrivateHosts: true }));
    expect(creds.reason).toBe("CREDENTIALS");
  });
});
